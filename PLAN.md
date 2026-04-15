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

### Phase 6 — Canvas Edit Mode

> **Full specification:** [`docs/edit-mode.md`](docs/edit-mode.md)
>
> A visual way to create and modify character graphs directly on the canvas.
> Local-first: edits live in `sessionStorage` until a backend endpoint is wired up.
> The canvas and LTG source will eventually stay in sync bidirectionally.

#### 6.1 — Data Model & Session Helpers ✅
- [x] `src/types/editGraph.ts` — `EditableGraph`, `EditableCharacter`, `EditableRelationship` types
- [x] `src/lib/editGraphSession.ts` — `createEmptyGraph`, `saveEditGraph`, `loadEditGraph`, `clearEditGraph`
- [x] `src/lib/editableToSnapshot.ts` — `editableToSnapshot(graph, atUnit) → GraphSnapshot`
- [x] Unit tests for `editableToSnapshot`

#### 6.2 — App-Level State & Snapshot Derivation ✅
- [x] Add `editGraph: EditableGraph | null` state to `App.tsx`
- [x] `handleNewGraph()` — create empty graph, set `editMode = true`, reset `currentUnit = 1`
- [x] `handleSaveGraph()` — call `saveEditGraph`, emit "Saved" toast
- [x] `handleExitEdit()` — clear `editGraph` from state, set `editMode = false`
- [x] Snapshot derivation priority: `editGraph` → `localGraph` → backend
- [x] Resume in-progress edit session from `sessionStorage` on mount

#### 6.3 — "New Graph" Button in Viewer Toolbar ✅
- [x] Add "New Graph" `ToolbarButton` to `SideToolbar` (below "Edit Mode")
- [x] Wire `onClick` to `handleNewGraph`

#### 6.4 — Editable Title in Header ✅
- [x] Render `<input>` instead of `<span>` for title when `editMode && editGraph != null`
- [x] On change: update `editGraph.title` in state
- [x] On blur / Enter / Escape: commit; reset to `"Untitled"` if empty

#### 6.5 — Edit Toolbar Component ✅
- [x] Swap `SideToolbar` children in `App.tsx` based on `editMode`
- [x] Edit toolbar: Save (wired), Exit (wired), New Node (wired), New Block / New Chapter / Edit Timeline (stubs → toast)

#### 6.6 — New Node on Canvas ✅
- [x] `onAddCharacter` prop on `GraphCanvas` — called with stub character
- [x] Place new node at viewport centre via `screenToFlowPosition`
- [x] `handleAddCharacter` in `App.tsx` — append to `editGraph.characters`, re-derive snapshot, save session

#### 6.7 — Inline Name Prompt for New Nodes ✅
- [x] `pendingNodeId` state in `GraphCanvas` — set on new node creation
- [x] `isNaming` field on `CharacterNodeData` — renders `<input>` over node label
- [x] On Enter / blur: commit name via `onCommitName(id, name)` prop; empty name treated as cancel
- [x] On Escape: call `onCancelNode(id)` — removes node from `editGraph`

#### 6.8 — Empty Canvas Hint ✅
- [x] When `editMode && nodes.length === 0`: centred hint overlay — `"Click New Node to add your first character"`

#### 6.9 — Timeline for New Graph ✅
- [x] `TimelineScrubber` handles `totalUnits: 1` gracefully (single centred point, track inert)

---

#### 6.10 — Relationship Authoring ✅

##### 6.10.1 — Edit mode connection handles ✅
- [x] `editMode?: boolean` added to `CharacterNodeData`; injected via `animatedNodes` memo in `GraphCanvas`
- [x] Handles switch from `!w-0 !h-0` to `!w-3 !h-3 group-hover:opacity-100` when `editMode`; `isConnectable` gated on `editMode`

##### 6.10.2 — Draw a new relationship ✅
- [x] `onConnect` prop on `GraphCanvas`; `handleAddRelationship` in `App.tsx` creates stub (`kind: 'ally'`, `directed: false`, `introducedAt: currentUnit`); opens `RelationshipEditPanel` immediately

##### 6.10.3 — `RelationshipEditPanel` component ✅
- [x] `src/components/RelationshipEditPanel.tsx` — same slide-in shell as `CharacterEditPanel`
- [x] Fields: Label (live onChange), Kind (select, syncs label on change), Directed (Toggle + **Flip direction** button), From / Until (number, blur-commit)
- [x] Delete button at bottom (destructive style)

##### 6.10.4 — Wire edge selection ✅
- [x] `onEdgeClick` in `GraphCanvas` → `onSelectRelationship` prop
- [x] `panelRelationship` + `relPanelOpen` state in `App.tsx` (RAF/timer open-close); mutual-exclusion with character panel
- [x] `handleUpdateRelationship` patches `editGraph.relationships`; syncs `panelRelationship`

##### 6.10.5 — Delete relationship ✅
- [x] Delete button in panel → `handleDeleteRelationship`
- [x] `onEdgesDelete` + `deleteKeyCode="Delete"` on `<ReactFlow>` in edit mode

---

#### 6.11 — Right-Click Node Context Menu ✅

##### 6.11.1 — `NodeContextMenu` component ✅
- [x] `src/components/NodeContextMenu.tsx` — `position: fixed` at `{x, y}`; `z-50`
- [x] Closes on outside mousedown (capture phase listener — bypasses React Flow's `stopPropagation`) or `Escape`
- [x] Two-click delete confirmation with 2.5 s auto-reset

##### 6.11.2 — Wire `onNodeContextMenu` in `GraphCanvas` ✅
- [x] `onNodeContextMenu` prop; handler calls `e.preventDefault()` and forwards node id + `{clientX, clientY}`

##### 6.11.3 — Context menu actions in `App.tsx` ✅
- [x] `contextMenuNodeId` + `contextMenuPos` state
- [x] **Edit** — opens `CharacterEditPanel`
- [x] **Toggle deceased** — sets/clears `diedAt = currentUnit`; updates panel character if open
- [x] **Delete character** — cascades relationships; closes character/relationship panels if affected

---

#### 6.12 — Add / Remove Chapters ✅

##### 6.12.1 — Add chapter ✅
- [x] "New Chapter" toolbar button → `handleAddChapter`: increments `totalUnits`, advances `currentUnit` to new last chapter, saves

##### 6.12.2 — Remove last chapter ✅
- [x] "New Block" repurposed as "Remove Chapter" → `handleRemoveChapter`: guards `totalUnits === 1` with warning toast; decrements `totalUnits`; clamps `currentUnit`; clears `diedAt` for characters whose `diedAt > newTotal`; removes relationships with `introducedAt > newTotal`; clears `endedAt` for relationships where `endedAt > newTotal`

##### 6.12.3 — Scrubber validation ✅
- [x] `TimelineScrubber` reacts to `totalUnits` prop changes at runtime — no special handling needed (it's fully derived from props)
- [x] `currentUnit` clamped in `handleRemoveChapter` before save; scrubber `onChange` cannot produce out-of-range values

---

---

#### 6.13 — Backend Persistence

> Persist canvas-authored graphs to the database. The frontend already holds the full
> graph in `editGraph: GraphSnapshot`; this phase writes it to PostgreSQL and returns
> a stable server-assigned UUID so future saves use PATCH instead of POST.

##### 6.13.1 — Migration 007: `custom_metadata` on `series`
- [ ] `backend/migrations/up/007_series_custom_metadata.up.sql`: `ALTER TABLE series ADD COLUMN custom_metadata JSONB DEFAULT NULL`
- [ ] `backend/migrations/down/007_series_custom_metadata.down.sql`: `ALTER TABLE series DROP COLUMN custom_metadata`
- [ ] Update `domain.Series` to add `CustomMetadata map[string]string \`json:"customMetadata,omitempty"\``
- [ ] Update `GetAllSeries` and `GetSeriesByID` queries to scan the new column
- [ ] Update `GetCompiledGraph` to include `customMetadata` in the `CompiledGraph.Series` so the LTG emitter can emit `metadata <key>: "<value>"` tags

##### 6.13.2 — Backend: `ImportPayload` domain type
- [ ] Add `domain.ImportPayload` to `types.go`:
  ```go
  type ImportSeries struct {
    Title          string            `json:"title"`
    MediaType      MediaType         `json:"mediaType"`
    UnitLabel      string            `json:"unitLabel"`
    TotalUnits     int               `json:"totalUnits"`
    Author         *string           `json:"author,omitempty"`
    GroupType      *string           `json:"groupType,omitempty"`
    CustomMetadata map[string]string `json:"customMetadata,omitempty"`
  }

  type ImportCharacter struct {
    ID           uuid.UUID  `json:"id"`
    Name         string     `json:"name"`
    Aliases      []string   `json:"aliases"`
    Description  *string    `json:"description,omitempty"`
    ImageURL     *string    `json:"imageUrl,omitempty"`
    IntroducedAt int        `json:"introducedAt"`
    DiedAt       *int       `json:"diedAt,omitempty"`
  }

  type ImportRelationship struct {
    ID           uuid.UUID         `json:"id"`
    FromID       uuid.UUID         `json:"fromId"`
    ToID         uuid.UUID         `json:"toId"`
    Kind         *RelationshipKind `json:"kind,omitempty"`
    Label        string            `json:"label"`
    Directed     bool              `json:"directed"`
    IntroducedAt int               `json:"introducedAt"`
    EndedAt      *int              `json:"endedAt,omitempty"`
  }

  type ImportPayload struct {
    Series        ImportSeries        `json:"series"`
    Characters    []ImportCharacter   `json:"characters"`
    Relationships []ImportRelationship `json:"relationships"`
  }
  ```
- [ ] Validate: `totalUnits >= 1`, `mediaType` in `{book, show, film}`, all `introducedAt >= 1`, relationship endpoints reference characters present in the payload

##### 6.13.3 — Backend: `CreateGraph` store function
- [ ] `db.CreateGraph(ctx, pool, payload ImportPayload) (uuid.UUID, error)` — runs in a single transaction:
  1. `INSERT INTO series (title, media_type, unit_label, total_units, author, group_type, custom_metadata) VALUES (...) RETURNING id` — server generates UUID
  2. Batch-insert all `payload.Characters` using the server-assigned series UUID
  3. Batch-insert all `payload.Relationships` (FK on characters)
- [ ] Return the new series UUID to the caller
- [ ] On any error, roll back the transaction

##### 6.13.4 — Backend: `ReplaceGraph` store function
- [ ] `db.ReplaceGraph(ctx, pool, seriesID uuid.UUID, payload ImportPayload) error` — runs in a single transaction:
  1. `UPDATE series SET title = ..., media_type = ..., ... WHERE id = $1`
  2. `DELETE FROM characters WHERE series_id = $1` — cascades to `relationships` and `character_renames` via `ON DELETE CASCADE`
  3. Batch-insert all `payload.Characters`
  4. Batch-insert all `payload.Relationships`
- [ ] Return error on any failure; roll back on error
- [ ] Note: `blocks` and `series_colours` are untouched — they are populated by the LTG import pipeline, not the canvas editor

##### 6.13.5 — Backend: `POST /api/series` handler
- [ ] Bind and validate `ImportPayload` from JSON body; return `400` on invalid payload
- [ ] Call `store.CreateGraph(ctx, payload)`; return `500` on error
- [ ] Return `201 Created` with `{ "id": "<uuid>" }`

##### 6.13.6 — Backend: `PATCH /api/series/:id` handler
- [ ] Parse `:id` as UUID; return `400` on invalid
- [ ] Verify series exists (`store.GetSeriesByID`); return `404` if not found
- [ ] Bind and validate `ImportPayload`; return `400` on invalid
- [ ] Call `store.ReplaceGraph(ctx, id, payload)`; return `500` on error
- [ ] Return `200 OK` with the updated `domain.Series` (re-fetch via `GetSeriesByID`)

##### 6.13.7 — Backend: Router + Store interface + CORS
- [ ] Add `CreateGraph` and `ReplaceGraph` to `api.Store` interface (`store.go`)
- [ ] Add `PGStore` implementations delegating to the `db` package
- [ ] Register routes in `router.go`:
  ```
  POST  /api/series
  PATCH /api/series/:id
  ```
- [ ] Add `PATCH` to `corsMiddleware` allowed methods (already has it — confirm)

##### 6.13.8 — Frontend: API client functions
- [ ] `createGraph(payload: ImportPayload): Promise<Result<{ id: string }, ApiError>>` — `POST /api/series`
- [ ] `patchGraph(id: string, payload: ImportPayload): Promise<Result<void, ApiError>>` — `PATCH /api/series/:id`
- [ ] `ImportPayload` type in `src/api/client.ts` matching the backend shape (derived from `GraphSnapshot` — strip `atUnit`, use `series` subset, strip `seriesId` from characters/relationships)
- [ ] Unit tests for both client functions

##### 6.13.9 — Frontend: Wire save to backend
- [ ] Helper `isBackendId(id: string): boolean` — returns true when the series id is a real UUID (not `edit:*` or `preview`)
- [ ] `graphSnapshotToImport(graph: GraphSnapshot): ImportPayload` — mapping function in `src/lib/importPayload.ts`
- [ ] Update `handleSaveGraph` in `App.tsx`:
  - If `isBackendId(editGraph.series.id)`: call `patchGraph` in the background; show "Saved" on success, error toast on failure
  - Else (new graph): call `createGraph`; on success, update `editGraph.series.id` (and `viewerGraph`, sessionStorage, localStorage) with the server-assigned UUID; show "Saved" toast; on failure, show error toast and keep editing (do not exit)
- [ ] `handleSaveGraph` remains non-blocking for the user — the toast fires after the API call resolves

##### 6.13.10 — Future: Auto-save via debounced PATCH
- [ ] Once 6.13.9 is wired: add a `useEffect` that debounces `editGraph` changes (e.g. 5 s) and calls `patchGraph` silently when `isBackendId(editGraph.series.id)` is true
- [ ] Show a subtle "Saving…" indicator in the toolbar while the PATCH is in-flight
- [ ] On success: update `editBaseRef` so the "unsaved changes" dialog does not fire for auto-saved changes

---

---

#### 6.14 — Bidirectional LTG Sync

> Canvas ↔ code editor stay in sync. Editing the canvas reflects in the LTG source;
> editing the source reflects on the canvas. Partial sync (canvas → code on open) is
> already live; this phase completes the loop with live two-way updates.

##### Already done (foundation)
- [x] `compiledToFullSnapshot` — render result becomes `editGraph` when in edit mode
- [x] `snapshotToAst` / `graphSnapshotToLtg` — emit valid LTG from any `GraphSnapshot`
- [x] "Code Editor" button in edit toolbar emits from `editGraph` on every open (canvas → code on demand)
- [x] Render button while in edit mode sets `editGraph` from compiled result (code → canvas)

##### 6.14.1 — Live canvas → code sync
- [ ] When the code editor panel is open and `editGraph` changes (any canvas edit), debounce 500 ms and re-emit LTG into the editor — replace the editor content with the updated source
- [ ] Preserve cursor position and selection if the user is mid-edit (Monaco `setValue` with selection restore)
- [ ] Show a subtle "↻ synced" flash in the editor gutter when content is auto-updated

##### 6.14.2 — Incremental AST diff (avoid full-replace rewrite)
- [ ] Instead of emitting the full LTG string on every canvas change, compute an AST diff between the previous and new `LtgAst`
- [ ] Map diff nodes to Monaco `ITextEdit[]` operations — surgical edits rather than full-document replace
- [ ] This preserves comments, formatting, and manually added block labels that the snapshot round-trip would otherwise erase

##### 6.14.3 — Block label and group structure round-trip
- [ ] `snapshotToAst` currently emits unlabelled blocks (`new chapter:`) — no block labels or groups survive the canvas round-trip
- [ ] Add `blockLabels: Map<number, string>` and `groupStructure` fields to `GraphSnapshot` (or a parallel `EditGraphMetadata` type)
- [ ] Persist these via the metadata panel ("Edit Timeline" button — 6.14.4) so they survive save/load
- [ ] `snapshotToAst` emits block labels when present

##### 6.14.4 — Edit Timeline tool (block labels + groups)
- [ ] Wire the "Edit Timeline" stub button to a timeline editor overlay
- [ ] Lets user assign display labels to individual blocks (e.g. "The Storm" for chapter 6)
- [ ] Lets user group consecutive blocks into named arcs/volumes/seasons
- [ ] Persisted in `editGraph` and round-tripped through `snapshotToAst`

---

### Future Edit Mode (later phases)

- Edit existing backend graphs (any series loaded into edit mode, not just canvas-created ones)
- Character rename events tracked through canvas UI (adds `rename` statements to emitted LTG)

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
