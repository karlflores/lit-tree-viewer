# Edit Mode — LitTree

> Specification for the visual graph authoring experience. Edit mode lets users
> create and modify character relationship graphs directly on the canvas, without
> writing LTG source code. The two representations (visual canvas ↔ LTG source)
> will eventually stay in sync bidirectionally; this document focuses on the
> canvas-first authoring flow.

---

## Design Principles

- **Local-first.** All edits are held in `sessionStorage` until the user explicitly
  saves to the backend. There is no auto-save or draft sync.
- **Independent of the backend API.** The edit model lives entirely in the frontend
  for now. A future `POST /api/series` + `POST /api/import` endpoint will persist it.
- **Non-destructive entry.** Entering edit mode snapshots the viewed graph into
  editable state; exiting restores the viewer without altering the source data.
- **Chapter-scoped mutations.** Every canvas action (add node, draw relationship,
  mark deceased) is applied at the currently selected chapter. The timeline scrubber
  remains active in edit mode.

---

## Application Modes

| Mode | Triggered by | Graph source |
|---|---|---|
| **View mode** | Default on load | Backend API |
| **Editor view mode** | "Open in Editor" → Render | LTG compiler (`CompileSuccess`) |
| **Edit mode (existing)** | "Edit Mode" button | Current `layoutSnapshot` merged with `currentUnit` snapshot |
| **Edit mode (new graph)** | "New Graph" button | Empty `GraphSnapshot` in `sessionStorage` |

---

## Data Model

Edit mode reuses the existing domain types — no separate `EditableGraph` type exists.
The editable state is a plain `GraphSnapshot` held in `App.tsx` state and persisted
to `sessionStorage`.

```typescript
// From src/types/domain.ts — same type used for both viewer and edit mode
type GraphSnapshot = {
  series:        Series
  characters:    readonly Character[]
  relationships: readonly Relationship[]
  atUnit:        number
  colours?:      Readonly<Record<string, string>>
}
```

The key difference from a viewer snapshot: the edit graph stores **all characters and
relationships across all time**, not just those active at a single chapter.
`editableToSnapshot(graph, atUnit)` applies the temporal filter on demand.

For new nodes and relationships added in edit mode, IDs are generated client-side
using `crypto.randomUUID()`.

### Session Storage

Key: `litree:edit-graph`
Value: `JSON.stringify(GraphSnapshot)`

Helpers in `src/lib/editGraphSession.ts`:
- `createEmptyGraph()` — returns a blank `GraphSnapshot` with a generated `edit:<uuid>` series ID, `totalUnits: 1`, no characters
- `saveEditGraph(graph)` — write to sessionStorage
- `loadEditGraph()` — read and parse; validates `graph.series` is present to reject stale pre-refactor data; returns `null` on miss, parse error, or invalid shape
- `clearEditGraph()` — remove the key

### `editableToSnapshot`

`src/lib/editableToSnapshot.ts` — takes the full edit `GraphSnapshot` and a target
`atUnit`, returns a filtered snapshot using the same temporal rules as
`compiledToSnapshot`:

```typescript
export function editableToSnapshot(graph: GraphSnapshot, atUnit: number): GraphSnapshot
```

- Characters whose `introducedAt > atUnit` are excluded
- Relationships whose `introducedAt > atUnit` are excluded
- Relationships whose `endedAt < atUnit` are excluded
- Relationships referencing an absent character are excluded
- `atUnit` is clamped to `[1, series.totalUnits]`

---

## UI Changes

### Viewer Toolbar (view mode)

| Button | Action |
|---|---|
| **Edit Mode** | Snapshot the current graph into editable state and enter edit mode; if already in edit mode, exits and restores the viewer |
| **New Graph** | Create a blank edit graph (`createEmptyGraph`), enter edit mode |

### Header — Editable Title

When in edit mode the series title in the header becomes an inline `<input>`:

```
◈ LitTree  ·  [___ Untitled ___]           Chapter 1
```

- Controlled input bound to `editGraph.series.title`
- On focus: stores the current title in a ref (for Escape revert)
- On change: updates `editGraph.series` in state
- On blur / Enter: commits; resets to `"Untitled"` if empty; saves to sessionStorage
- On Escape: reverts to the stored pre-edit value; saves; blurs

### Edit Toolbar (replaces viewer toolbar in edit mode)

The `SideToolbar` children swap out when `editMode === true`. The edit toolbar
contains:

| Button | Icon hint | Action |
|---|---|---|
| **Save** | floppy disk | Serialise `editGraph` → `sessionStorage`; show a brief "Saved" notification |
| **New Node** | `+` person | Place a new character at the canvas viewport centre; open an inline name-entry prompt |
| **Exit** | `←` arrow | Leave edit mode; clear `editGraph` from state (not from sessionStorage); restore viewer toolbar |

All three buttons use the existing `ToolbarButton` component (pill shape, hover-expand label).

### Canvas in Edit Mode

- **Empty state**: when `editGraph.characters` is empty, show a centred hint:
  `"Click New Node to add your first character"`
- **Node dragging**: unchanged — users can reposition nodes freely
- **New node placement**: nodes are placed at the centre of the current viewport
  (using `reactFlowInstance.screenToFlowPosition` at the canvas midpoint)
- **Inline name prompt**: a small floating input appears over the new node
  immediately after creation; pressing Enter or clicking away commits the name

### Timeline in Edit Mode

For a new graph, `totalUnits = 1` so the scrubber shows a single chapter.
The scrubber remains functional and drives `currentUnit`, which scopes future
node-add and relationship-draw operations.

---

## State Flow

```
App.tsx state
  editMode:  boolean              — true when in edit mode
  editGraph: GraphSnapshot | null — non-null only while in edit mode

  Snapshot derivation (both display and layout):
    if editMode && editGraph != null → editableToSnapshot(editGraph, atUnit)
    else if localGraph != null       → compiledToSnapshot(localGraph, atUnit)
    else                             → backend graphData snapshot
```

### Data queries (mount-time, parallel)

Three queries fire on mount and are cached indefinitely (`staleTime: Infinity`):

| Hook | Endpoint | Purpose |
|---|---|---|
| `useGraphData(id, currentUnit)` | `GET /graph?at=N` | Current chapter display; prefetches all units |
| `useFullGraph(id)` | `GET /graph/full` | Layout positions + edit mode base |
| `useCompiledGraph(id)` | `GET /compiled` | LTG source emission for "Open in Editor" |

### Entering edit mode (`handleToggleEditMode`)

The "Edit Mode" button calls `handleToggleEditMode`, which uses `fullGraphData.snapshot`
(from `useFullGraph`) as the edit base. Because `GET /graph/full` returns all
characters and all relationships with no temporal filtering, no ended relationships
are silently dropped — the full history is available from the first render.

Falls back to `layoutSnapshot` if `fullGraphData` hasn't resolved yet (should
be rare since all three queries fire in parallel on mount).

### Snapshot priority gating

Both `editableSnapshot` and `fullEditableSnapshot` are gated on
`editMode && editGraph !== null`. Toggling the "Edit Mode" button off immediately
drops the edit snapshot and falls through to `localGraph` / backend data, without
needing to clear `editGraph` from state first.

### Session resume

On mount, `loadEditGraph()` checks sessionStorage. If a valid `GraphSnapshot` is
found (validated by the presence of a `series` field), the app restores
`editGraph`, sets `editMode = true`, and resets `currentUnit = 1`. Stale
pre-refactor data (old flat `EditableGraph` shape) is automatically discarded.

---

## Phased Task Breakdown (Phase 6)

### 6.1 — Data Model & Session Helpers ✅
- [x] ~~`src/types/editGraph.ts`~~ — removed after type consolidation; domain types used directly
- [x] `src/lib/editGraphSession.ts`: `createEmptyGraph`, `saveEditGraph`, `loadEditGraph`, `clearEditGraph`
- [x] `src/lib/editableToSnapshot.ts`: `editableToSnapshot(graph: GraphSnapshot, atUnit) → GraphSnapshot`
- [x] Unit-test `editableToSnapshot`: empty graph, character filtering, diedAt, relationship filtering, field mapping, optional kind

### 6.2 — App-Level State & Snapshot Derivation ✅
- [x] Add `editGraph: GraphSnapshot | null` state to `App.tsx`
- [x] Add `handleNewGraph()`: create empty graph, set `editMode = true`, reset `currentUnit = 1`
- [x] Add `handleSaveGraph()`: call `saveEditGraph(editGraph)`, emit a "Saved" toast
- [x] Add `handleExitEdit()`: clear `editGraph` from state (keep sessionStorage), set `editMode = false`
- [x] Snapshot derivation gated on `editMode && editGraph !== null` (not just `editGraph !== null`)
- [x] Resume in-progress edit session from sessionStorage on mount
- [x] `handleToggleEditMode`: uses `fullGraphData.snapshot` (all relationships) as edit base; calls `handleExitEdit` on exit
- [x] `useFullGraph` hook — `GET /graph/full`, single fetch, `staleTime: Infinity`; replaces second `useGraphData` call and the merge workaround
- [x] `useCompiledGraph` hook — `GET /compiled`, single fetch, `staleTime: Infinity`; makes "Open in Editor" instant (no click-time request)

### 6.3 — "New Graph" Button in Viewer Toolbar ✅
- [x] Add "New Graph" `ToolbarButton` to `SideToolbar` in `App.tsx` (below "Edit Mode")
- [x] Wire `onClick` to `handleNewGraph`
- [x] Icon: document with `+` badge

### 6.4 — Editable Title in Header ✅
- [x] When `editMode && editGraph != null`, render `<input>` instead of `<span>` for series title
- [x] Transparent background, white text, `border-b border-white/30` on focus
- [x] On change: update `editGraph.series.title` in state
- [x] On blur / Enter: commit; reset to `"Untitled"` if empty; save to sessionStorage
- [x] On Escape: revert to pre-focus value via `titleBeforeEditRef`; save; blur

### 6.5 — Edit Toolbar ✅
- [x] Swap `SideToolbar` children in `App.tsx` based on `editMode` (no separate component needed — inline JSX)
- [x] Edit toolbar: Save (wired to `handleSaveGraph`), Exit (wired to `handleExitEdit`), New Node (wired), New Block / New Chapter / Edit Timeline (stubs — show info toast; wired in 6.12)

### 6.6 — New Node on Canvas ✅
- [x] `addNodeTrigger: number` + `onAddCharacter` props on `GraphCanvas`
- [x] `AddNodeHandler` inner component (inside ReactFlow provider): detects trigger increment, calls `screenToFlowPosition` at window centre, pre-seeds position in `savedPositionsRef`, creates stub `Character`, calls `onAddCharacter`
- [x] `handleAddCharacter` in `App.tsx`: append to `editGraph.characters`, save session

### 6.7 — Inline Name Prompt for New Nodes ✅
- [x] `pendingNodeId: string | null` state in `GraphCanvas`; set by `handleNodeCreated` wrapper around `onAddCharacter`
- [x] `isNaming`, `onCommitName`, `onCancelNode` fields on `CharacterNodeData`; injected at the `animatedNodes` memo layer for the pending node only
- [x] `CharacterNode` renders `<input autoFocus>` when `isNaming`; `nodrag nopan` classes prevent canvas interaction while typing
- [x] Enter / blur: `onCommitName(id, name)`; empty name treated as cancel
- [x] Escape: `escapedRef` prevents double-fire; `onCancelNode(id)` removes node from `editGraph`

### 6.8 — Empty Canvas Hint ✅
- [x] `editMode` prop on `GraphCanvas`; when `editMode && animatedNodes.length === 0` renders a centred dashed-circle + plus icon overlay with the hint text
- [x] `pointer-events-none` — never blocks interaction

### 6.9 — Timeline for New Graph ✅
- [x] `progressOf` helper: `singleUnit ? 0.5 : (unit-1)/(totalUnits-1)` — cursor and label centred for `totalUnits: 1`
- [x] Pointer and hover handlers short-circuit when `singleUnit` — track is fully inert
- [x] Unit test: `totalUnits: 1` → both buttons disabled, `onChange` never called on pointer events

---

### 6.10 — Relationship Authoring ✅

#### 6.10.1 — Edit mode connection handles ✅
- [x] `editMode?: boolean` in `CharacterNodeData`; injected at `animatedNodes` memo layer
- [x] Handles: `!w-3 !h-3 group-hover:opacity-100` in edit mode; `isConnectable` gated on `editMode`

#### 6.10.2 — Draw a new relationship ✅
- [x] `onConnect` prop on `GraphCanvas`; `handleAddRelationship` creates stub, opens `RelationshipEditPanel` immediately

#### 6.10.3 — `RelationshipEditPanel` component ✅
- [x] `src/components/RelationshipEditPanel.tsx` — Label, Kind (select), Directed (Toggle) + **Flip direction** button, From / Until
- [x] Delete button (destructive); `useEffect([relationship.id])` resets on selection change

#### 6.10.4 — Wire edge selection ✅
- [x] `onEdgeClick` → `onSelectRelationship`; `panelRelationship` + `relPanelOpen` with mutual-exclusion vs character panel

#### 6.10.5 — Delete relationship ✅
- [x] Panel delete button + `onEdgesDelete` / `deleteKeyCode="Delete"` on `<ReactFlow>`

---

### 6.11 — Right-Click Node Context Menu ✅

#### 6.11.1 — `NodeContextMenu` component ✅
- [x] `src/components/NodeContextMenu.tsx` — `position: fixed`; capture-phase `mousedown` listener (bypasses React Flow `stopPropagation`); Escape closes
- [x] Two-click delete confirmation with 2.5 s auto-reset

#### 6.11.2 — Wire `onNodeContextMenu` in `GraphCanvas` ✅
- [x] `onNodeContextMenu` prop; `e.preventDefault()` + forward id + `{clientX, clientY}`

#### 6.11.3 — Context menu actions in `App.tsx` ✅
- [x] `contextMenuNodeId` + `contextMenuPos` state
- [x] **Edit** → `CharacterEditPanel`; **Toggle deceased** → set/clear `diedAt`; **Delete** → cascade + close panels

---

### 6.12 — Add / Remove Chapters ✅

#### 6.12.1 — Add chapter ✅
- [x] "New Chapter" (previously "New Block" stub) → `handleAddChapter`: `totalUnits += 1`, `currentUnit = newTotal`, save

#### 6.12.2 — Remove last chapter ✅
- [x] "Remove Chapter" button → `handleRemoveChapter`: guards single-chapter case with warning toast; `totalUnits -= 1`; clamps `currentUnit`; clears `diedAt` for characters `> newTotal`; removes/cleans relationships `introducedAt > newTotal` or `endedAt > newTotal`

#### 6.12.3 — Scrubber validation ✅
- [x] `TimelineScrubber` is fully prop-driven — reacts correctly to runtime `totalUnits` changes
- [x] `currentUnit` clamped at source in `handleRemoveChapter`

---

---

### 6.13 — Backend Persistence

> Persist canvas-authored graphs to the database. Triggered by the Save button.
> First save: `POST /api/series` — backend assigns a stable UUID.
> Subsequent saves: `PATCH /api/series/:id` — full replace in a transaction.

#### Architecture

```
editGraph (GraphSnapshot, in-memory + sessionStorage)
    │  Save button / auto-save
    ▼
graphSnapshotToImport(graph) → ImportPayload
    │
    ├─ isBackendId(series.id) = false  →  POST /api/series  →  { id }
    │                                      ↓ update editGraph.series.id
    └─ isBackendId(series.id) = true   →  PATCH /api/series/:id
```

**Key invariant:** The `series.id` in `editGraph` starts as `edit:<uuid>` (client-only).
After the first successful `POST`, it is replaced with the server-assigned UUID.
All subsequent `PATCH` calls use that stable UUID.

#### Data flow for `ImportPayload`

The frontend `GraphSnapshot` maps directly to `ImportPayload`:
- `series` → drop `id` (server assigns), strip `totalUnits` lower-bound to 1
- `characters` → drop `seriesId` (server fills from context), drop `ltgIdentifier`, `renames`, `description`, `imageUrl` are optional
- `relationships` → drop `seriesId`

`blocks` and `series_colours` are **not** written by the canvas editor — they are populated exclusively by the LTG import pipeline.

#### 6.13.1 — Migration 007: `custom_metadata` on `series` ✅ (spec only — not yet applied)
- [ ] `007_series_custom_metadata.up.sql`: `ALTER TABLE series ADD COLUMN custom_metadata JSONB DEFAULT NULL`
- [ ] `007_series_custom_metadata.down.sql`: `ALTER TABLE series DROP COLUMN custom_metadata`
- [ ] Update `domain.Series` with `CustomMetadata map[string]string`
- [ ] Update `GetAllSeries`, `GetSeriesByID`, `GetCompiledGraph` to scan + include the new column

#### 6.13.2 — Backend: `ImportPayload` domain type
- [ ] `domain.ImportSeries` — `title, mediaType, unitLabel, totalUnits, author?, groupType?, customMetadata?`
- [ ] `domain.ImportCharacter` — `id (UUID), name, aliases, description?, imageUrl?, introducedAt, diedAt?`
- [ ] `domain.ImportRelationship` — `id (UUID), fromId, toId, kind?, label, directed, introducedAt, endedAt?`
- [ ] `domain.ImportPayload` — `{ series, characters [], relationships [] }`
- [ ] Validation: `totalUnits >= 1`, `mediaType ∈ {book,show,film}`, all `introducedAt >= 1`, relationship endpoints present in characters list

#### 6.13.3 — Backend: `CreateGraph` store function
- [ ] `db.CreateGraph(ctx, pool, payload) → (uuid.UUID, error)` — single transaction:
  1. `INSERT INTO series (...) VALUES (...) RETURNING id` — server generates UUID
  2. Batch `INSERT INTO characters` with the new series UUID
  3. Batch `INSERT INTO relationships` after characters are committed
- [ ] Roll back on any error; return new series UUID on success

#### 6.13.4 — Backend: `ReplaceGraph` store function
- [ ] `db.ReplaceGraph(ctx, pool, seriesID, payload) → error` — single transaction:
  1. `UPDATE series SET ... WHERE id = $1`
  2. `DELETE FROM characters WHERE series_id = $1` — cascades to `relationships` and `character_renames`
  3. Batch `INSERT INTO characters`
  4. Batch `INSERT INTO relationships`
- [ ] `blocks` and `series_colours` are untouched

#### 6.13.5 — Backend: `POST /api/series` handler
- [ ] Bind + validate `ImportPayload`; return `400` on invalid
- [ ] Call `store.CreateGraph`; return `500` on error
- [ ] Return `201 Created` with `{ "id": "<uuid>" }`

#### 6.13.6 — Backend: `PATCH /api/series/:id` handler
- [ ] Parse `:id` UUID; `400` on invalid; `404` if series not found
- [ ] Bind + validate `ImportPayload`; `400` on invalid
- [ ] Call `store.ReplaceGraph`; `500` on error
- [ ] Return `200 OK` with updated `domain.Series`

#### 6.13.7 — Backend: Router + Store interface
- [ ] Add `CreateGraph` and `ReplaceGraph` to `api.Store` interface
- [ ] Register `POST /api/series` and `PATCH /api/series/:id` in `router.go`
- [ ] Confirm `PATCH` is in `corsMiddleware` allowed methods

#### 6.13.8 — Frontend: API client functions (`src/api/client.ts`)
- [ ] `ImportPayload` TypeScript type (mirrors backend shape)
- [ ] `graphSnapshotToImport(graph: GraphSnapshot): ImportPayload` in `src/lib/importPayload.ts`
- [ ] `isBackendId(id: string): boolean` — true when id is a plain UUID (not `edit:*` or `"preview"`)
- [ ] `createGraph(payload): Promise<Result<{ id: string }, ApiError>>` — `POST /api/series`
- [ ] `patchGraph(id, payload): Promise<Result<void, ApiError>>` — `PATCH /api/series/:id`
- [ ] Unit tests for `graphSnapshotToImport` and `isBackendId`

#### 6.13.9 — Frontend: Wire save to backend
- [ ] `handleSaveGraph` in `App.tsx`:
  - If `isBackendId(id)`: call `patchGraph`; on success show "Saved" toast; on failure show error toast
  - Else: call `createGraph`; on success update `editGraph.series.id` (+ `viewerGraph` + storage) with server UUID; on failure show error toast and remain in edit mode
- [ ] Save is non-blocking — optimistic local save (sessionStorage + viewerGraph) happens immediately; API call is async

#### 6.13.10 — Future: Auto-save via debounced PATCH
- [ ] `useEffect` on `editGraph` — debounce 5 s, call `patchGraph` silently when `isBackendId` is true
- [ ] Subtle "Saving…" state in toolbar during in-flight PATCH
- [ ] On success: advance `editBaseRef` so the exit confirm dialog does not trigger for auto-saved state

---

---

### 6.14 — Bidirectional LTG Sync

> The code editor and canvas stay in sync. Partial sync is already live; this phase
> completes the loop with live two-way updates and structural round-tripping.

#### Foundation (already done) ✅
- `compiledToFullSnapshot` — Render in edit mode converts `CompileSuccess` → full `GraphSnapshot` and sets it as `editGraph`; `editBaseRef` advances so the result is treated as clean
- `snapshotToAst` / `graphSnapshotToLtg` — emit valid LTG from any `GraphSnapshot`; uses `ltgIdentifier` when present, derives slug from name for canvas-created nodes
- "Code Editor" button in edit toolbar always re-emits from `editGraph` on click (canvas → code on demand, not just toggle)
- `SideToolbar` stays visible when editor is open in edit mode (button remains accessible)

#### 6.14.1 — Live canvas → code sync (auto-update)
- [ ] When the code editor panel is open and `editGraph` changes (any canvas mutation), debounce 500 ms and push the new LTG source into the editor
- [ ] Preserve cursor position and selection across auto-updates (Monaco `ITextModel.pushEditOperations` or `setValue` with selection restore)
- [ ] Show a subtle "↻" indicator in the editor header when content was auto-updated

#### 6.14.2 — Incremental AST diff (surgical edits)
- [ ] Current: full LTG string replace on every canvas change — blows away user formatting and cursor
- [ ] Compute `LtgAst` diff between previous and new states; map diffs to `ITextEdit[]`
- [ ] This preserves comments, block labels, and any manually formatted lines the user has typed

#### 6.14.3 — Block label and group structure round-trip
- [ ] `snapshotToAst` currently emits unlabelled `new chapter:` blocks — labels and groups are lost after a canvas round-trip
- [ ] Add `blockLabels: Record<number, string>` and `blockGroups: { label: string; range: [number, number] }[]` to `Series` or a parallel metadata type
- [ ] Persist these through save/load so `snapshotToAst` can emit `new chapter: "The Storm"` style blocks
- [ ] Wire the "Edit Timeline" button (6.14.4) to edit this structure

#### 6.14.4 — Edit Timeline tool (block labels + arc grouping)
- [ ] Wire "Edit Timeline" stub in the edit toolbar to a timeline editor overlay
- [ ] Allow users to assign display labels to individual blocks
- [ ] Allow users to group consecutive blocks into named arcs/volumes/seasons (`group "Season 1":`)
- [ ] Persist structure in `editGraph` and round-trip through `snapshotToAst`

---

## Future Phases (later)

### Edit Existing Backend Graphs
Load any persisted series into edit mode (not just canvas-created ones). Re-use `GET /series/:id/graph/full` as the edit base; `PATCH /api/series/:id` to write back.

### Character Rename Events in Canvas
Track name changes through canvas UI — adds `rename` statements to emitted LTG source.

### ~~Edit Existing Backend Graph (full fidelity)~~ ✅ (resolved in 6.2)
`useFullGraph` hook consumes `GET /graph/full`; `handleToggleEditMode` uses it as the edit base.
