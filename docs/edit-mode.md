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

### 6.10 — Relationship Authoring

#### 6.10.1 — Edit mode connection handles
- [ ] Add `editMode?: boolean` to `CharacterNodeData`; inject in `GraphCanvas` when edit mode is active
- [ ] In `CharacterNode`, when `editMode`: transition handles from `opacity-0 w-0 h-0` to visible on hover — small coloured ring, `cursor-crosshair`

#### 6.10.2 — Draw a new relationship
- [ ] Add `onConnect` prop to `GraphCanvas` (React Flow `OnConnect` type); only registered on `<ReactFlow>` when `editMode` is true
- [ ] `handleAddRelationship(connection)` in `App.tsx`: create stub `Relationship` — `id: crypto.randomUUID()`, `seriesId`, `fromId/toId` from connection, `kind: 'ally'`, `label: 'ally'`, `directed: false`, `introducedAt: currentUnit`, `endedAt: null`; append to `editGraph.relationships`, save; immediately open `RelationshipEditPanel` for the new edge

#### 6.10.3 — `RelationshipEditPanel` component
- [ ] `src/components/RelationshipEditPanel.tsx` — same slide-in shell as `CharacterEditPanel` (`absolute right-3 top-4 bottom-4 w-72`)
- [ ] Fields: **Label** (text), **Kind** (select — `family | parent_child | romantic | ally | rival | enemy | mentor | other`), **Directed** (toggle), **Introduced at** (number), **Ended at** (number, optional — blank = still active)
- [ ] Name propagates on `onChange`; numeric and select fields commit on blur (same pattern as `CharacterEditPanel`)
- [ ] **Delete** button at the bottom — calls `onDelete(id)`, closes panel
- [ ] `useEffect([relationship.id])` resets local state when a different edge is selected

#### 6.10.4 — Wire edge selection
- [ ] `onSelectRelationship?: (rel: Relationship | null) => void` prop on `GraphCanvas`
- [ ] `onEdgeClick` in `GraphCanvas`: look up `Relationship` by `edge.id` in `snapshot.relationships`, call `onSelectRelationship`
- [ ] `panelRelationship` + `relPanelOpen` state in `App.tsx` (same RAF open / timer close pattern as character panel)
- [ ] In edit mode, render `RelationshipEditPanel`; `handleUpdateRelationship` patches the matching entry in `editGraph.relationships`, saves

#### 6.10.5 — Delete relationship
- [ ] `handleDeleteRelationship(id)` in `App.tsx`: filter from `editGraph.relationships`, save, close panel
- [ ] Wire `onEdgesDelete` on `<ReactFlow>` in edit mode — React Flow fires this on `Delete`/`Backspace` key when an edge is selected; handler calls `handleDeleteRelationship` for each deleted edge

---

### 6.11 — Right-Click Node Context Menu

#### 6.11.1 — `NodeContextMenu` component
- [ ] `src/components/NodeContextMenu.tsx` — `position: fixed` div at `{ x, y }` (screen coordinates from the right-click event)
- [ ] Menu items as `<button>` rows with consistent hover style (`hover:bg-white/10`, `text-xs`)
- [ ] Close on outside `mousedown` (`useEffect` + document listener) or `Escape` key
- [ ] `z-50` to float above everything; `pointer-events-auto`

#### 6.11.2 — Wire `onNodeContextMenu` in `GraphCanvas`
- [ ] Add `onNodeContextMenu?: (id: string, position: { x: number; y: number }) => void` prop
- [ ] In `GraphCanvas`, attach `onNodeContextMenu` to `<ReactFlow>` only when the prop is set; call `e.preventDefault()` and forward `{ id: node.id, position: { x: e.clientX, y: e.clientY } }`

#### 6.11.3 — Context menu actions in `App.tsx`
- [ ] `contextMenuNodeId: string | null` + `contextMenuPos: { x: number; y: number } | null` state; set by `handleNodeContextMenu`
- [ ] Render `<NodeContextMenu>` when `editMode && contextMenuNodeId !== null`
- [ ] **Edit** — call `handleSelectCharacter(character)` (opens `CharacterEditPanel`); close menu
- [ ] **Toggle deceased** — if `diedAt === null` or `diedAt > currentUnit`: set `diedAt = currentUnit`; else clear `diedAt = null`; update character in `editGraph`, save
- [ ] **Delete character** — remove from `editGraph.characters`; filter out all relationships where `fromId === id || toId === id`; if this character was the panel character, close the panel; save

---

### 6.12 — Add / Remove Chapters

#### 6.12.1 — Add chapter
- [ ] Wire "New Chapter" toolbar button to `handleAddChapter` (replaces info toast)
- [ ] `handleAddChapter`: increment `editGraph.series.totalUnits` by 1; advance `currentUnit` to the new last chapter; save

#### 6.12.2 — Remove last chapter
- [ ] Repurpose "New Block" toolbar button as "Remove Chapter" (update label and icon)
- [ ] `handleRemoveChapter`: if `totalUnits === 1` show a warning toast and return; otherwise decrement `totalUnits`; clamp `currentUnit` to new total; set `diedAt = null` for characters whose `diedAt >= newTotal` (they outlive the new end); remove relationships whose `introducedAt > newTotal`; save

#### 6.12.3 — Scrubber validation
- [ ] Confirm `TimelineScrubber` correctly renders and resizes when `totalUnits` changes at runtime (no layout bugs on grow or shrink)
- [ ] Confirm `onChange` is never fired with a unit outside `[1, totalUnits]` after a remove operation

---

## Future Phases (out of scope)

### Edit Existing Backend Graphs
- `GET /api/series/:id/graph/full` already implemented; wire "Edit Mode" to load any series into edit mode with full relationship history

### Backend Persistence
- `POST /api/series` — create series
- `POST /api/import` — upsert characters + relationships
- Save button posts the full edit graph converted to the import payload

### Bidirectional LTG Sync
- Canvas mutations produce LTG AST diffs; code editor reflects changes in real time
- LTG source edits update the canvas without a full re-compile

### Edit Timeline Visual Tool
- Group chapters into volumes/arcs (LTG `group` construct)
- Drag-resize arc spans on the scrubber

### ~~Edit Existing Backend Graph (full fidelity)~~ ✅ (resolved in 6.2)
- `useFullGraph` hook consumes `GET /graph/full`; `handleToggleEditMode` uses it as the edit base
