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

#### 6.13 — Backend Persistence ✅

##### 6.13.1 — Migration 007: `custom_metadata` on `series` ✅
- [x] `007_series_custom_metadata.up.sql` / `.down.sql`
- [x] `domain.Series.CustomMetadata map[string]string` — scanned via `json.Unmarshal` on raw JSONB bytes; written with `::jsonb` cast

##### 6.13.2 — Backend: `ImportPayload` domain type ✅
- [x] `ImportSeries`, `ImportCharacter`, `ImportRelationship`, `ImportPayload` in `domain/types.go`
- [x] `validateImportPayload` in `handlers.go`: title required, `totalUnits >= 1`, valid mediaType, all `introducedAt >= 1`, relationship endpoints reference payload characters

##### 6.13.3 — Backend: `CreateGraph` store function ✅
- [x] Single transaction: `INSERT INTO series RETURNING id` → batch insert characters → batch insert relationships

##### 6.13.4 — Backend: `ReplaceGraph` store function ✅
- [x] Single transaction: `UPDATE series` → `DELETE FROM characters` (cascades) → batch insert characters → batch insert relationships
- [x] `blocks` and `series_colours` are untouched

##### 6.13.5 — Backend: `POST /api/series` handler ✅
- [x] `createSeries` handler → `201 { "id": "<uuid>" }`

##### 6.13.6 — Backend: `PATCH /api/series/:id` handler ✅
- [x] `patchSeries` handler → `200 Series`; 404 if not found

##### 6.13.7 — Backend: Router + Store interface + CORS ✅
- [x] `CreateGraph` / `ReplaceGraph` added to `api.Store` interface and `PGStore`
- [x] Routes registered; `PATCH` added to CORS allowed methods; router test updated

##### 6.13.8 — Frontend: API client + helpers ✅
- [x] `src/lib/importPayload.ts`: `ImportPayload` type, `isBackendId`, `graphSnapshotToImport` (UUID memo for LTG-identifier nodes), `applyIdRemap`
- [x] `src/api/client.ts`: `mutate` helper, `createGraph`, `patchGraph`

##### 6.13.9 — Frontend: Wire save to backend ✅
- [x] `handleSaveGraph` is now `async`: local save is immediate; POST/PATCH fires after
- [x] On successful POST: `applyIdRemap` patches `editGraph` + storage with server UUID; all subsequent saves use PATCH
- [x] Error toasts on network/server failure; success toast after backend confirms

##### 6.13.10 — Auto-save via debounced PATCH ✅
- [x] Debounce 5 s on `editGraph` changes; silent PATCH when `isBackendId` is true
- [x] "Saving…" toolbar indicator; advance `editBaseRef` on success

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
- [x] All edit-mode panels (CharacterEditPanel, RelationshipEditPanel, GraphMetadataPanel) close automatically when exiting edit mode

##### 6.14.1 — Live canvas → code sync ✅
- [x] `syncContent` prop on `CodeEditorPanel` (separate from one-shot `externalContent`) — replaces document with cursor position preserved via `EditorSelection.single` clamped to new length
- [x] Debounced 500 ms `useEffect` in `App.tsx` on `[editGraph, editMode, editorOpen]` — sets `editorSyncContent`
- [x] `skipSyncUntilRef` suppresses the sync for 1 s after Render to avoid overwriting the user's source
- [x] "↻ synced" flash in editor header for 1.5 s after each auto-update

##### 6.14.1b — Auto-render on newline (code → canvas live sync) ✅
- [x] Update listener in `CodeEditorPanel` detects newline insertion via `changes.iterChanges`
- [x] Debounced 600 ms compile request fires after each newline (slightly after the 400 ms LSP `didChange` so the server has the latest doc)
- [x] On clean compile: calls `onCompileAndRender` silently — no toast, no spinner; best-effort
- [x] `connectedRef` / `onCompileAndRenderRef` / `autoRenderInProgressRef` prevent stale closures and concurrent requests
- [x] `skipSyncUntilRef` in `App.tsx` already suppresses the canvas→code bounce-back for 1 s after render

##### 6.14.2 — Incremental AST diff (avoid full-replace rewrite)
- [ ] Instead of emitting the full LTG string on every canvas change, compute an AST diff between the previous and new `LtgAst`
- [ ] Map diff nodes to Monaco `ITextEdit[]` operations — surgical edits rather than full-document replace
- [ ] This preserves comments, formatting, and manually added block labels that the snapshot round-trip would otherwise erase

##### 6.14.3 — Block label and group structure round-trip
- [ ] `snapshotToAst` currently emits unlabelled blocks (`new chapter:`) — no block labels or groups survive the canvas round-trip
- [ ] Add `blockLabels: Map<number, string>` and `groupStructure` fields to `GraphSnapshot` (or a parallel `EditGraphMetadata` type)
- [ ] Persist these via the metadata panel ("Edit Timeline" button — 6.14.4) so they survive save/load
- [ ] `snapshotToAst` emits block labels when present

##### 6.14.4 — Edit Timeline tool (block labels + groups) ✅
- [x] `EditTimelinePanel` component — same slide-in shell as other panels; mutual exclusion with character/relationship/metadata panels and on edit-mode exit
- [x] Block labels section: list of all blocks 2–N with optional label inputs; block 1 shown as read-only "init (fixed)"; ● dot indicator on blocks that belong to a group
- [x] Groups section: add/remove groups; each entry has a label input + from/to number selectors constrained to valid ranges; placeholder adapts to `series.groupType`
- [x] `handleOpenTimeline` + `timelinePanelOpen` state in `App.tsx`; reuses `handleUpdateSeriesMetadata` for persistence
- [x] "Edit Timeline" toolbar button wired; `active` highlight when panel is open
- [x] Persisted in `editGraph.series.{blockLabels,blockGroups}` and round-tripped through `snapshotToAst` (already handled by 6.14.3)

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

### Phase 8 — Browse Media

> A discoverable library of published graphs. Users can search by keyword, filter
> by media type, and sort results. Requires a `published` concept on the series table
> so only curator-approved graphs appear in the browse view.

#### 8.1 — Backend: `published` flag + search endpoint ✅

##### 8.1.1 — Migration: `published` column on `series` ✅
- [x] `migration 008_browse_seed.up.sql` — `ALTER TABLE series ADD COLUMN published BOOLEAN NOT NULL DEFAULT false`; marks WH as published; seeds 5 new example graphs (Pride and Prejudice, The Count of Monte Cristo, Breaking Bad, Succession, The Godfather)
- [x] `migration 008_browse_seed.down.sql` — removes example series, reverts WH, drops column
- [x] `domain.Series.Published bool`; `domain.SeriesSummary`; `domain.SearchParams`; `domain.SearchResult`
- [x] All series scan queries updated to include `published`

##### 8.1.2 — Search endpoint ✅
- [x] `GET /api/series/search?q=&mediaType=&sortBy=&sortDir=&limit=&offset=`
- [x] ILIKE keyword search against `title` and `author`; comma-separated `mediaType` filter; dynamic sort column (validated server-side); `limit` capped at 50; only `published = true` graphs returned
- [x] Response: `{ results: SeriesSummary[], total: int }` with `characterCount` via LEFT JOIN aggregate
- [x] `SearchSeries` in `db/queries.go` with parameterised WHERE + injected (validated) ORDER BY

##### 8.1.3 — Router + store wiring ✅
- [x] `SearchSeries` on `Store` interface and `PGStore`
- [x] Route registered: `GET /api/series/search` (original `GET /api/series` list endpoint preserved)

#### 8.2 — Frontend: Browse panel ✅

##### 8.2.1 — "Browse Media" option in MenuPanel ✅
- [x] "Discover" section added to `MenuPanel`; "Browse media" button calls `onBrowse()` prop then closes

##### 8.2.2 — `BrowsePanel` component ✅
- [x] `src/components/BrowsePanel.tsx` — slide-in from left; same RAF mount/unmount pattern
- [x] Sequence counter (`searchSeqRef`) prevents stale responses from overwriting newer results

##### 8.2.3 — Search bar ✅
- [x] 300 ms debounced input; clear (×) button when non-empty; loading skeleton (pulse animation)

##### 8.2.4 — Filter + sort controls ✅
- [x] "Filters" toggle reveals media type pills (Book / Show / Film, multi-select) with active count badge
- [x] Sort-by dropdown + asc/desc toggle icon button

##### 8.2.5 — Results list ✅
- [x] `SeriesCard` — title, colour-coded media badge, author, chapter count, character count
- [x] Empty state; result count header; "Load more" offset pagination
- [x] Clicking a card fetches full graph, sets as `viewerGraph`, closes panel

##### 8.2.6 — Wire into App.tsx ✅
- [x] `selectedSeriesId` state (replaces hardcoded `SERIES_ID`) — all three hooks re-fetch on change
- [x] `browseMounted` / `browseOpen` state + RAF helpers + cleanup
- [x] `handleSelectBrowseSeries` — `fetchFullGraph(id)` → `setViewerGraph` + `setSelectedSeriesId` + `setCurrentUnit(1)`
- [x] `SideToolbar` and `TimelineScrubber` hide when browse panel is open
- [x] Browse panel closes on edit mode entry

---

### Phase 9 — Authentication & Sessions

> Google SSO via OAuth 2.0 Authorization Code flow. Server-side sessions backed by
> Redis — stateless JWT is deferred until multi-region is needed. Auth gates write
> operations (save, notes) and eventually browse (Phase 9.3). Read-only viewing
> remains public.

#### 9.1 — Infrastructure

##### 9.1.1 — User table migration
- [ ] `CREATE TABLE users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), google_id TEXT UNIQUE NOT NULL, email TEXT NOT NULL, display_name TEXT NOT NULL, avatar_url TEXT, role TEXT NOT NULL DEFAULT 'user', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen_at TIMESTAMPTZ)`
- [ ] Role enum values (enforced in Go, not as a PG enum for easier migration): `user`, `moderator`, `admin`

##### 9.1.2 — Session store (Redis)
- [ ] Add Redis to `compose.yaml` (service: `redis`, image: `redis:7-alpine`, port `6379`)
- [ ] `SESSION_SECRET`, `REDIS_URL` added to backend config (`config.go`)
- [ ] Session key: `session:<token>` → JSON-encoded `{ userID, role, expiresAt }`
- [ ] TTL: 7 days; sliding expiry — refreshed on each authenticated request
- [ ] Session token: 32-byte crypto-random, base64url-encoded; sent as `HttpOnly; Secure; SameSite=Lax` cookie named `ltree_session`

##### 9.1.3 — Google OAuth credentials
- [ ] `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` in config
- [ ] Redirect URI: `<base_url>/auth/google/callback`

#### 9.2 — Backend auth flow

##### 9.2.1 — OAuth endpoints
- [ ] `GET /auth/google` — redirect to Google's authorization URL with `openid email profile` scopes
- [ ] `GET /auth/google/callback` — exchange code for token; fetch user info from `https://www.googleapis.com/oauth2/v3/userinfo`; upsert user row (`ON CONFLICT (google_id) DO UPDATE SET last_seen_at = now(), display_name = ...`); create session in Redis; set cookie; redirect to `/`

##### 9.2.2 — Session middleware
- [ ] `AuthMiddleware` — reads `ltree_session` cookie; looks up session in Redis; injects `*domain.User` into Gin context (`ctx.Set("user", user)`); slides TTL; returns `401` if missing/expired
- [ ] `OptionalAuthMiddleware` — same but does not 401 on miss; injects `nil` user; used for public routes that optionally personalise

##### 9.2.3 — Auth utility endpoints
- [ ] `GET /api/me` → `200 { id, email, displayName, avatarUrl, role }` (requires auth)
- [ ] `POST /auth/logout` → clears Redis session; clears cookie; `204`

##### 9.2.4 — Protect write routes
- [ ] `POST /api/series`, `PATCH /api/series/:id` — require `AuthMiddleware`; store `created_by = user.ID` on series (new nullable column, migration required)
- [ ] Notes endpoints (Phase 10) require `AuthMiddleware`

#### 9.3 — Frontend auth integration

##### 9.3.1 — Auth state
- [ ] `useAuth` hook — `GET /api/me` on mount; returns `{ user, loading, refetch }`
- [ ] `user` is `null` when unauthenticated; `User` type: `{ id, email, displayName, avatarUrl, role }`
- [ ] Auth state shared via React context (`AuthContext`)

##### 9.3.2 — Header: user menu
- [ ] When unauthenticated: "Sign in" button in header → redirects to `/auth/google`
- [ ] When authenticated: avatar circle (initials fallback) in header; click opens a small dropdown — display name, email, "Sign out" button
- [ ] Sign out: `POST /auth/logout`; clear local auth state; no page reload needed

##### 9.3.3 — Gate write operations
- [ ] Save button in edit mode: if unauthenticated, show "Sign in to save" prompt instead of saving
- [ ] New graph button: works offline (canvas-only); saving to backend requires auth
- [ ] Browse Media (Phase 8): public read; no auth required to browse

##### 9.3.4 — Session persistence
- [ ] Cookie is `HttpOnly` (not readable by JS); auth state determined purely via `/api/me` response
- [ ] On `401` from any API call, dispatch a global "session expired" toast and clear auth state

---

### Phase 10 — Notes System

> Per-user, per-character notes attached to a specific chapter. Notes are private —
> visible only to the user who wrote them, never to other users. The key UX is a
> character notes timeline: all notes for a character sorted chronologically by
> chapter, giving the reader a personal annotation history.

#### 10.1 — Data model

##### 10.1.1 — `notes` table migration
- [ ] ```sql
      CREATE TABLE notes (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        series_id    UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
        character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        chapter      INT  NOT NULL,
        content      TEXT NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
      ```
- [ ] Index: `(user_id, series_id)` — supports fetching all notes for a user+series in one query
- [ ] Index: `(user_id, character_id)` — supports per-character timeline query

##### 10.1.2 — Domain types (Go)
- [ ] `domain.Note { ID, UserID, SeriesID, CharacterID, Chapter, Content, CreatedAt, UpdatedAt }`

#### 10.2 — Backend

##### 10.2.1 — Store functions
- [ ] `GetNotesForSeries(userID, seriesID) ([]Note, error)` — all notes for a user+series, ordered by `character_id, chapter`
- [ ] `GetNotesForCharacter(userID, characterID) ([]Note, error)` — all notes for a specific character, ordered by `chapter`
- [ ] `UpsertNote(userID, seriesID, characterID, chapter, content) (Note, error)` — insert or update (unique on `user_id, character_id, chapter`)
- [ ] `DeleteNote(userID, noteID) error` — only deletes if `user_id` matches (ownership guard)

##### 10.2.2 — API endpoints (all require `AuthMiddleware`)
- [ ] `GET  /api/series/:id/notes` → `[]Note` (all notes for current user on this series)
- [ ] `PUT  /api/series/:id/characters/:charId/notes/:chapter` → upsert; body `{ content: string }`; `201` on create, `200` on update
- [ ] `DELETE /api/notes/:noteId` → `204`; 403 if note belongs to different user

#### 10.3 — Frontend

##### 10.3.1 — Note data fetching
- [ ] `useNotes(seriesId)` hook — `GET /api/series/:id/notes`; only fetches when user is authenticated; `staleTime: 0` (always fresh)
- [ ] `notesMap` derived: `Map<characterId, Map<chapter, Note>>` — O(1) lookup in render

##### 10.3.2 — Note indicator on character nodes
- [ ] `CharacterNode` receives `hasNote: boolean` prop (injected via `animatedNodes` in `GraphCanvas`)
- [ ] When `hasNote` is true: small filled circle badge on the node (top-right corner), colour-coded to the note colour

##### 10.3.3 — Notes in CharacterPanel (viewer mode)
- [ ] New "Notes" section at the bottom of `CharacterPanel`
- [ ] If unauthenticated: "Sign in to add notes" prompt
- [ ] If authenticated: textarea for note at the current chapter; auto-saves on blur (debounced 500 ms)
- [ ] Existing note pre-fills the textarea; empty save deletes the note

##### 10.3.4 — Character notes timeline
- [ ] "View all notes" link/button in the Notes section of `CharacterPanel`
- [ ] Opens a `CharacterNotesPanel` — slide-in panel showing all notes for that character sorted by chapter ascending
- [ ] Each entry: chapter label + chapter number, note content, edit/delete actions
- [ ] Empty state: "No notes for this character yet"

##### 10.3.5 — Notes require auth gate
- [ ] All note mutations guarded: if `user` is null, show inline "Sign in to save notes" rather than firing the API

---

### Phase 11 — Admin UI & Role-Based Access Control

> Operators need to manage users and control which graphs are visible to the public.
> A three-tier role system (User → Moderator → Admin) gates access to management
> and publishing workflows. The admin UI is a separate frontend route, not embedded
> in the main viewer.

#### 11.1 — Role system (backend)

##### 11.1.1 — Role middleware
- [ ] `RequireRole(roles ...string)` Gin middleware — reads `user` from context (set by `AuthMiddleware`); returns `403` if `user.Role` not in `roles`
- [ ] Usage: `RequireRole("moderator", "admin")` for mod routes; `RequireRole("admin")` for admin-only routes

##### 11.1.2 — Role assignment endpoint (admin only)
- [ ] `PATCH /admin/users/:id` → body `{ role: "user" | "moderator" | "admin" }`; `RequireRole("admin")`
- [ ] Also supports `{ banned: true }` — sets a `banned_at TIMESTAMPTZ` column; `AuthMiddleware` rejects banned sessions with `403`

##### 11.1.3 — `banned_at` column migration
- [ ] `ALTER TABLE users ADD COLUMN banned_at TIMESTAMPTZ`
- [ ] `AuthMiddleware` checks `banned_at IS NOT NULL` after session lookup; returns `403 { error: "account_banned" }`

#### 11.2 — Graph publishing workflow

##### 11.2.1 — Moderator review queue
- [ ] `GET /mod/series?published=false` → lists unpublished graphs; `RequireRole("moderator", "admin")`
- [ ] `PATCH /mod/series/:id` → body `{ published: true | false }`; `RequireRole("moderator", "admin")`
- [ ] Audit column: `published_by UUID REFERENCES users(id)`, `published_at TIMESTAMPTZ` (migration required)

##### 11.2.2 — Submit for review (authenticated user)
- [ ] `POST /api/series/:id/submit` → sets a `submitted_at TIMESTAMPTZ` column (migration); `200` or `409` if already submitted
- [ ] Submitted graphs appear in the moderator queue; unpublished + not submitted = private draft

#### 11.3 — Admin API

##### 11.3.1 — User management endpoints (admin only)
- [ ] `GET  /admin/users?q=&role=&banned=&limit=&offset=` → paginated user list; `RequireRole("admin")`
- [ ] `GET  /admin/users/:id` → single user with all their series
- [ ] `PATCH /admin/users/:id` → role, banned_at (see 11.1.2)
- [ ] `DELETE /admin/users/:id` → hard delete (cascades to series, notes); confirm required

##### 11.3.2 — Graph management endpoints (admin only)
- [ ] `GET  /admin/series?q=&published=&userId=&limit=&offset=` → all graphs, unfiltered by published status
- [ ] `PATCH /admin/series/:id` → `{ published, submitted_at: null }` (can reset submission)
- [ ] `DELETE /admin/series/:id` → hard delete

#### 11.4 — Admin frontend (`/admin` route)

##### 11.4.1 — Route structure
- [ ] `/admin` redirect → `/admin/users`
- [ ] `/admin/users` — user management table
- [ ] `/admin/graphs` — graph management table
- [ ] `/mod/review` — moderator review queue
- [ ] All admin routes: redirect to `/` if `user.role` is not `admin` / `moderator` as appropriate

##### 11.4.2 — User management table (`/admin/users`)
- [ ] Columns: avatar, display name, email, role (editable dropdown), banned status, created date, last seen, action buttons
- [ ] Search bar: filters by name/email
- [ ] Role filter: User / Moderator / Admin / All
- [ ] Banned filter: Show all / Active only / Banned only
- [ ] Inline role change: dropdown triggers `PATCH /admin/users/:id`; optimistic update
- [ ] Ban/unban toggle button; two-click confirmation for destructive actions
- [ ] Delete user: two-click confirmation; shows count of graphs that will be deleted

##### 11.4.3 — Graph management table (`/admin/graphs`)
- [ ] Columns: title, author, media type, chapters, characters, owner email, published status, submitted date, action buttons
- [ ] Search bar + media type filter + published status filter
- [ ] Publish/unpublish toggle: `PATCH /admin/series/:id`; optimistic update
- [ ] Delete graph: two-click confirmation
- [ ] Click row → opens graph in viewer (new tab or inline)

##### 11.4.4 — Moderator review queue (`/mod/review`)
- [ ] Lists submitted, unpublished graphs oldest-first
- [ ] Each card: title, author, media type, character count, submission date, "Preview" link
- [ ] **Approve** button → `PATCH /mod/series/:id { published: true }`
- [ ] **Reject** button → `PATCH /mod/series/:id { submitted_at: null }` (returns to draft); optional rejection note (future)
- [ ] Empty state: "No graphs awaiting review"

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
