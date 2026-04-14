# LitTree — Interactive Character Relationship Viewer

> Inspired by reading *The Count of Monte Cristo*. A web app for exploring character
> relationships across a timeline of chapters or episodes — built for long-form fiction
> like Lord of the Rings, Harry Potter, and sprawling fantasy worlds.

---

## Vision

An interactive graph viewer where users can scrub through a chapter/episode timeline and
watch relationships between characters evolve in real time. Relationships appear, change
type, and dissolve as the story progresses. A character detail panel surfaces rich info
about each character — sourced automatically or entered manually.

Eventually doubles as an editor: create series, add characters, draw relationships, and
annotate when each one begins or ends.

---

## Design Decisions (Locked)

| Concern | Decision |
|---|---|
| Edge directionality | Both directed and undirected edges supported. Type determines direction. |
| Edge identity | Each edge has a **type** (drives visual style) and a **label** (human-readable, e.g. "adoptive father") |
| Graph layout | Ranked force layout (Phase 1–4). Always computed on the final chapter; prior chapters reuse cached positions. Auto-layout button in ZoomControls. |
| Node positions | Computed once on the full graph, cached to `savedPositionsRef` and `localStorage`. User-dragged positions persist across sessions. |
| Timeline granularity | Integer only — chapters for books, episodes for shows. No fractional positions. |
| Series scope | Single series to start (proves the concept). Multi-series added alongside the editor. |
| Character data | Hybrid: automated enrichment (Wikipedia / fan wikis / AI) + manual user input as override |
| Dead characters | Remain visible as greyed-out nodes by default. Toggle to hide them entirely. |
| Play mode | Deferred — add once scrubber is working. Straightforward extension. |
| Code style (frontend) | FP-forward TypeScript: discriminated unions, `readonly` data types, pure transform functions, no classes, `neverthrow` for Result/Option |
| Code style (backend) | FP-principled Go: pure functions, no shared mutable state, explicit data flow — idiomatic Go error handling (`T, error`), not monadic. No fp-ts-style abstractions. |

---

## Technology Stack

### Frontend
| Layer | Choice | Notes |
|---|---|---|
| Build | Vite + React + TypeScript | Standard, fast DX |
| Styling | Tailwind CSS | Utility-first, component-scoped |
| Graph | **React Flow** | Interactive node/edge canvas, zoom/pan/drag, custom node + edge components |
| State | Zustand | Lightweight global state, pairs well with React Flow |
| Data fetching | TanStack Query | Async state, caching, background refetch |

### Backend
| Layer | Choice | Notes |
|---|---|---|
| Language | Go | Fast, simple, low overhead |
| Framework | Gin | Minimal REST framework |
| DB driver | pgx + sqlx | Ergonomic PostgreSQL access |
| Database | **PostgreSQL** | Temporal queries via `introduced_at` / `ended_at` integer columns |

### Why PostgreSQL over a Graph DB

Graph databases (Neo4j, ArangoDB) don't solve the temporal dimension any better than
SQL — you'd still need to model time on top of them. The core query is simple:

```sql
SELECT * FROM relationships
WHERE series_id = $1
  AND introduced_at <= $2
  AND (ended_at IS NULL OR ended_at >= $2)
```

Character graphs in this domain are small (tens to low hundreds of nodes). No need for
a graph traversal engine. PostgreSQL with proper indexes is more than sufficient and
reduces operational complexity.

---

## Database Schema

```sql
-- A book series, TV show, or film
series (
  id          UUID PRIMARY KEY,
  title       TEXT NOT NULL,
  media_type  TEXT NOT NULL,       -- 'book' | 'show' | 'film'
  unit_label  TEXT NOT NULL,       -- 'Chapter' | 'Episode' | 'Part'
  total_units INT NOT NULL
)

-- Characters within a series
characters (
  id              UUID PRIMARY KEY,
  series_id       UUID REFERENCES series(id),
  name            TEXT NOT NULL,
  aliases         TEXT[],          -- e.g. {"Edmond Dantès", "Sinbad"}
  description     TEXT,            -- enriched or user-written
  image_url       TEXT,
  introduced_at   INT NOT NULL,    -- chapter/episode they first appear
  died_at         INT              -- NULL if alive/unknown
)

-- Directed or undirected relationships with a time window
relationships (
  id              UUID PRIMARY KEY,
  series_id       UUID REFERENCES series(id),
  from_id         UUID REFERENCES characters(id),
  to_id           UUID REFERENCES characters(id),
  type            TEXT NOT NULL,   -- see Relationship Types below
  label           TEXT,            -- e.g. "adoptive father", "sworn enemy"
  directed        BOOLEAN NOT NULL DEFAULT false,
  introduced_at   INT NOT NULL,
  ended_at        INT              -- NULL = still active
)
```

### Relationship Types (initial set)
Visual style (color + line pattern) is driven by type.

| Type | Direction | Example |
|---|---|---|
| `family` | undirected | siblings, cousins |
| `parent_child` | directed | parent → child |
| `romantic` | undirected | lovers, spouses |
| `ally` | undirected | friends, companions |
| `rival` | undirected | competitors |
| `enemy` | directed or undirected | active antagonism |
| `mentor` | directed | mentor → student |
| `other` | either | catch-all |

---

## API Endpoints (Phase 1)

```
GET  /series                          List all series
GET  /series/:id                      Series metadata
GET  /series/:id/graph?at=14          Full graph snapshot at chapter 14
GET  /series/:id/characters/:charId   Single character detail
```

The `/graph` endpoint returns characters + relationships filtered to the given chapter.
The frontend holds no filtering logic — the server owns the temporal query.

---

## Character Enrichment System

Character detail panel data can come from three sources, in priority order:

1. **User-authored** — manually written description, uploaded image. Always wins.
2. **Fan wiki (Fandom/Wikia API)** — query by series name + character name. Rich lore content.
3. **Wikipedia API** — fallback for well-known works.
4. **AI-generated (Claude API)** — synthesise a summary from series + character name when
   no wiki data is available. Clearly labelled as AI-generated.

Enrichment is triggered on first view of a character (lazy) and cached in the `description`
/ `image_url` columns. Users can always overwrite with their own content.

---

## UI Layout

### Main Viewer

```
┌─────────────────────────────────────────────────────────────────┐
│  ◈ LitTree          The Count of Monte Cristo       [Edit Mode] │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                        ┌──────────┐                             │
│              ┌─────────│  Edmond  │──────────┐                  │
│              │         └──────────┘          │                  │
│         [romantic]                       [enemy ▶]              │
│              │                                │                 │
│        ┌──────────┐                    ┌──────────┐             │
│        │ Mercédès │                    │ Fernand  │             │
│        └──────────┘                    └──────────┘             │
│              │                                │                 │
│         [mother]                         [◀ rival]              │
│              │                                │                 │
│        ┌──────────┐                    ┌──────────┐             │
│        │  Albert  │                    │  Danglars│             │
│        └──────────┘                    └──────────┘             │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  Ch 1      Ch 20      Ch 40      Ch 60      Ch 80      Ch 117   │
│  ├──────────────────────────●────────────────────────────┤      │
│                           Chapter 62                            │
└─────────────────────────────────────────────────────────────────┘
```

### With Character Panel Open

```
┌────────────────────────────────────┬────────────────────────────┐
│  ◈ LitTree    Monte Cristo         │ ✕                          │
├────────────────────────────────────│  ┌──────┐                  │
│                                    │  │ img  │  Edmond Dantès   │
│           [graph]                  │  └──────┘  aka "Sinbad"    │
│                                    │                            │
│                                    │  A sailor falsely          │
│                                    │  imprisoned, who escapes   │
│                                    │  and returns as the        │
│                                    │  mysterious Count.         │
│                                    │                            │
│                                    │  First appears: Ch 1       │
│                                    │                            │
│                                    │  Relationships at Ch 62:   │
│                                    │  ↔ Mercédès  (romantic)    │
│                                    │  → Fernand   (enemy)       │
│                                    │  → Danglars  (rival)       │
│                                    │  ↔ Abbé Faria (mentor)     │
├────────────────────────────────────┴────────────────────────────┤
│  Ch 1  ├──────────────────────────●─────────────────────┤ Ch117 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phased Task Breakdown

### Phase 0 — Project Scaffolding
- [ ] Monorepo structure: `/frontend`, `/backend`, `/docs`
- [ ] Go module init + Gin + pgx wired up
- [ ] Vite + React + TS + Tailwind + React Flow installed
- [ ] Podman Compose: PostgreSQL local dev environment (`compose.yaml`)
- [ ] Database migrations (schema above)
- [ ] Seed data: one series (suggest: *The Count of Monte Cristo* or a simpler test case)

### Phase 1 — Backend API
- [ ] Series endpoints (`GET /series`, `GET /series/:id`)
- [ ] Graph snapshot endpoint (`GET /series/:id/graph?at=N`)
- [ ] Character detail endpoint
- [ ] CORS + basic middleware
- [ ] Unit tests for temporal filtering logic

### Phase 2 — Frontend Core (Viewer)
- [ ] Series landing page (single series for now, just navigate straight to it)
- [ ] Graph canvas page — React Flow integration
- [ ] Custom node component: avatar circle + name label, highlight on hover
- [ ] Custom edge component: styled by relationship type, label on hover
- [ ] Timeline scrubber component: slider + chapter markers + current label
- [ ] Scrubber → API → graph update loop with smooth transitions
- [ ] Character detail side panel (open on node click)
- [ ] Directed vs undirected edge rendering (arrowhead toggle)

### Phase 3 — Character Enrichment
- [ ] Enrichment service in Go (Wikipedia API → Fandom API → Claude API fallback)
- [ ] Cache enriched data back to DB
- [ ] Surface source label in character panel ("From Wikipedia", "AI generated")
- [ ] User override: manual edit of description + image upload

### Phase 4 — LTG Import Language (planned)

> Full specification: [`docs/ltg-spec.md`](docs/ltg-spec.md)

A declarative definition language (`.ltg` files) for authoring series, characters, and
relationship timelines — designed to be human-writable, statically type-checked, and
compilable directly to the LitTree domain model.

- [ ] **Phase A** — Specification *(done — see docs/ltg-spec.md)*
- [ ] **Phase B** — `ltg-langserver` (Rust): `logos` lexer, `chumsky` parser, type checker, compiler — stdio + WebSocket transports via `tower-lsp` + `axum`. All LTG intelligence lives here; the frontend has no parsing code.
- [ ] **Phase C** — Import UI (thin client): file-upload/paste modal, calls language server `POST /compile`, then `POST /api/import` to persist
- [ ] **Phase D** — Backend import API (`POST /api/import`, `GET /api/series/:id/export`) with upsert semantics
- [ ] **Phase E** — In-browser editor: Monaco + `monaco-languageclient` over WebSocket to the language server; diagnostics are pushed by the server via standard LSP `publishDiagnostics`
- [ ] **Phase F** — Tooling: VSCode extension (stdio LSP), CLI (`ltg check`, `ltg fmt`)

### Phase 5 — Graph Layout (Ranked Force Layout) ✅

> Full specification: [`docs/layout-algorithm.md`](docs/layout-algorithm.md)
>
> Replaces the Dagre-based layout with a four-phase ranked force algorithm:
> topological rank assignment → degree-weighted column placement →
> force-directed refinement → incremental new-node placement.
> An auto-layout button lets users re-run the full layout at any time.

#### 5.1 — Phase 1: Rank Assignment ✅
- [x] Extract directed subgraph from edge list
- [x] Compute in-degree map for the directed subgraph
- [x] Identify roots (in-degree = 0); fall back to highest-total-degree node if all in cycles
- [x] BFS longest-path layering: `rank[s] = max(rank[s], rank[n] + 1)`
- [x] Cycle detection and back-edge removal via iterative DFS grey-colouring
- [x] Rank assignment for undirected-only / isolated nodes (average of neighbour ranks, fallback to 0)
- [x] Unit tests: roots correct, ranks respect longest path, cycle handled, isolated node gets rank 0

#### 5.2 — Phase 2: Initial Position Assignment ✅
- [x] Group nodes by rank
- [x] Sort each rank row by total degree (descending), re-ordered centre-out so highest-degree node lands at x ≈ 0
- [x] Compute `COLUMN_SPACING = max(MIN_NODE_DIST, avg_degree_in_row * 20)`
- [x] Assign x by centred column index: `x[i] = (i - (count-1)/2) * COLUMN_SPACING`
- [x] Assign y by rank: `y = rank * RANK_HEIGHT`
- [x] Crossing minimisation: 5 rounds of forward/backward barycentric sweeps + greedy adjacent-swap pass
- [x] Unit tests: high-degree node is at lowest |x|; row width scales with degree

#### 5.3 — Phase 3: Force-Directed Refinement ✅
- [x] Repulsion force (all pairs, Coulomb `1/r²`; 10× hard push when `< MIN_NODE_DIST/2`)
- [x] Attraction force (edges only, Hooke; directed edges weight ×1.5)
- [x] Rank-anchoring force (y-axis pull toward `rank * RANK_HEIGHT`)
- [x] Centre-gravity force (prevent cluster drift)
- [x] Node-edge repulsion force (5th force — pushes nodes away from non-adjacent edge segments)
- [x] Euler integration with velocity damping, per-step `MAX_STEP` clamp (prevents divergence at close starts), and early-exit convergence
- [x] Post-processing: 30-pass hard node-node separation + 20-pass hard node-edge separation
- [x] All constants in a single `LAYOUT_CONSTANTS` export
- [x] Unit tests: no pair closer than `MIN_NODE_DIST` after refinement; converges within `MAX_ITERATIONS`

#### 5.4 — Phase 4: Incremental New Node Placement ✅
- [x] Detect new nodes (present in current graph but not in `savedPositions`)
- [x] Compute seed from average neighbour positions
- [x] 8-direction open-space scan to pick placement direction
- [x] Nudge loop (up to 50 attempts) to clear `MIN_NODE_DIST` overlap
- [x] Fallback: 4×4 grid density scan for nodes with no neighbours
- [x] 20-iteration force refinement with existing nodes frozen as anchors
- [x] Unit tests: new node ≥ `MIN_NODE_DIST` from all existing; placed near neighbours

#### 5.5 — Wire Up in GraphCanvas ✅
- [x] `applyLayout` used exclusively; `applyDagreLayout` removed
- [x] `layoutSnapshot` prop (final chapter) provides stable full-graph input
- [x] Two-effect pattern: layout effect `[layoutRawNodes, layoutEdges]` + data-sync effect `[currentRawNodes]`
- [x] After every layout run all positions written back to `savedPositionsRef` — timeline scrubs never re-trigger the force algorithm
- [x] `handleAutoLayout` operates on full graph regardless of displayed chapter
- [x] `@dagrejs/dagre` removed from `package.json` and `layout.ts`

#### 5.6 — Auto-Layout Button ✅
- [x] Auto Layout button in `ZoomControls`
- [x] Button calls `onAutoLayout` prop passed down from `GraphCanvas`
- [x] Animates all nodes to new positions via `useAnimatedLayout`

#### 5.7 — Edge Rendering ✅
- [x] Native bezier curves via `getBezierPath` (replaced custom straight-line SVG path)
- [x] Closest-anchor heuristic: 4 midpoint anchors per node; minimum-distance pair chosen; `Position` enum drives control-point direction
- [x] Parallel edges differentiated by varying `curvature` (fan out) rather than perpendicular pixel offset
- [x] Edge labels render at bezier midpoint with colour-matched styling

#### 5.8 — Tests and Cleanup ✅
- [x] `layout.test.ts` extended with Phase 1–4 coverage
- [x] `applyDagreLayout` and its tests removed
- [x] `@dagrejs/dagre` removed from `package.json`

### Phase 6 — Canvas Edit Mode (was Phase 5)

> **Concept:** A visual way to author LTG declarations. The canvas becomes an interactive
> editor where adding a node, drawing a relationship, or marking a character deceased
> produces the equivalent LTG statement in the underlying document. The two representations
> (visual graph ↔ LTG source) stay in sync bidirectionally.
>
> The timeline scrubber remains active in edit mode — the selected unit determines which
> block all mutations are applied to.

#### 5.1 — Edit Mode Toolbar
- [ ] When `editMode` is active, swap the standard `SideToolbar` children for the edit toolbar buttons (no structural changes to `SideToolbar` needed — it is already a generic container)
- [ ] **Save button** — persists the current graph state / compiled LTG back to the backend
- [ ] **Exit button** — leaves edit mode and restores the standard view toolbar
- [ ] **New Block button** — appends an empty block at the end of the timeline at the current unit type
- [ ] **New Chapter button** — appends a new chapter-type block (specific to series using `set block: chapter`) and advances the timeline to it
- [ ] **Edit Timeline button** — opens a timeline grouping tool for organising blocks into volumes/arcs (see §5.4 below)
- [ ] **New Node button** — creates a new character node; places it at the viewport centre and immediately opens an inline name-entry prompt

#### 5.2 — Canvas Interactions in Edit Mode
- [ ] **Right-click context menu on a node** — a small floating menu anchored to the node with actions:
  - Toggle deceased (adds/removes a `deceased <id>` event at the current unit)
  - Edit display name (inline edit of the character's current display name)
  - Rename at unit (adds a `rename <id>: "<new name>"` event at the current unit, preserving name history)
  - Delete node (removes the character — with a confirmation step; cascades to its relationships)
- [ ] **Drag to connect nodes** — dragging from a node handle to another node opens a "New Relationship" prompt (label, directed/undirected); emits a `link <label>(<a> -- <b>)` or `link <label>(<a> -> <b>)` event
- [ ] **Click a relationship edge in edit mode** — select it; shows an edge toolbar with: edit label, toggle direction, delete (emits `unlink`)

#### 5.3 — Timeline Integration
- [ ] The scrubber unit determines which block is being authored; the block index and label are shown prominently while in edit mode
- [ ] Mutations (new actor, link, unlink, deceased, rename) are always emitted into the block at `currentUnit`
- [ ] Navigating to a different unit in edit mode switches the editing context — a brief confirmation prompt if there are unsaved changes on the current block

#### 5.4 — Edit Timeline Tool (design TBD)
- [ ] Visual interface for grouping blocks into `group "..."` containers (volumes, arcs, seasons)
- [ ] Drag-to-reorder blocks within a group
- [ ] Create / rename / delete groups
- [ ] Exact interaction model to be fleshed out before implementation begins

#### 5.5 — Bidirectional LTG Sync
- [ ] Canvas mutations produce LTG AST diffs, not raw text edits — round-trip through the language server
- [ ] If the code editor is open alongside the canvas, it reflects changes in real time
- [ ] If the user edits LTG source and compiles, the canvas updates to match
- [ ] Conflict resolution strategy TBD (likely: last-write-wins per block, with the canonical source being the LTG document)

#### 5.6 — Multi-Series Support
- [ ] Series browser / landing page
- [ ] Create new series wizard (title, media type, unit label)
- [ ] Series switcher in the header

### Phase 7 — Character Enrichment (was Phase 6)
- [ ] Enrichment service in Go (Wikipedia API → Fandom API → Claude API fallback)
- [ ] Cache enriched data back to DB
- [ ] Surface source label in character panel ("From Wikipedia", "AI generated")
- [ ] User override: manual edit of description + image upload

---

## Open Questions (to revisit)

- For enrichment: do we call external APIs at read time (with a loading state) or
  pre-populate during series creation?

---

## Code Style Reference

### TypeScript — Frontend Patterns

```ts
// Discriminated union for relationship type
type RelationshipType =
  | { kind: 'family' }
  | { kind: 'parent_child'; direction: 'parent_to_child' | 'child_to_parent' }
  | { kind: 'romantic' }
  | { kind: 'ally' }
  | { kind: 'rival' }
  | { kind: 'enemy'; directed: boolean }
  | { kind: 'mentor'; direction: 'mentor_to_student' | 'student_to_mentor' }
  | { kind: 'other'; label: string }

// Discriminated union for character visibility state
type CharacterState =
  | { status: 'active' }
  | { status: 'deceased'; diedAt: number }
  | { status: 'not_yet_introduced' }

// Readonly data types — never mutate API responses
type Character = Readonly<{
  id: string
  name: string
  aliases: readonly string[]
  state: CharacterState
  introducedAt: number
  description: string | null
  imageUrl: string | null
}>

// Pure transform: derive graph snapshot from raw data
const toGraphSnapshot = (
  characters: readonly Character[],
  relationships: readonly Relationship[],
  atChapter: number
): GraphSnapshot => { ... }
```

### Go — Backend Patterns

```go
// Represent relationship type as a typed constant — no stringly-typed logic
type RelationshipKind string

const (
    KindFamily      RelationshipKind = "family"
    KindParentChild RelationshipKind = "parent_child"
    KindRomantic    RelationshipKind = "romantic"
    KindAlly        RelationshipKind = "ally"
    KindRival       RelationshipKind = "rival"
    KindEnemy       RelationshipKind = "enemy"
    KindMentor      RelationshipKind = "mentor"
    KindOther       RelationshipKind = "other"
)

// Pure function: takes data in, returns data out, no side effects
func filterRelationshipsAt(rels []Relationship, chapter int) []Relationship {
    result := make([]Relationship, 0, len(rels))
    for _, r := range rels {
        if r.IntroducedAt <= chapter && (r.EndedAt == nil || *r.EndedAt >= chapter) {
            result = append(result, r)
        }
    }
    return result
}

// Explicit error returns, no panics in business logic
func buildGraphSnapshot(db *DB, seriesID string, chapter int) (GraphSnapshot, error) { ... }
```

## Other notes: 
* I want to make the edit part of the application a sort of visual way of "coding" the declarative definitions. We should be able to convert between the two AND visually changing the graphs in the editor should change the declarations as well. This should be a good way to visually coding and going between both
* We need to implement a colour picker for the edges as well as a way to pick what type of edge we want to use 
* Need to double check the language definition. 
* At some point we would need to do some kind of user authentication -- need to look at providers SSO would be ideal and easiest tbh
* Add session data and persistence. Maybe also some sort of cache (redis?)
