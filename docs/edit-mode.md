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

### 6.13 — Backend Persistence ✅

**Key invariant:** `editGraph.series.id` starts as `edit:<uuid>`. After the first successful POST it becomes the server-assigned UUID; all subsequent saves call PATCH.

#### 6.13.1 ✅ Migration 007 — `custom_metadata JSONB` on `series`; `domain.Series.CustomMetadata map[string]string`; scan via `json.Unmarshal`; write via `::jsonb` cast
#### 6.13.2 ✅ `ImportSeries`, `ImportCharacter`, `ImportRelationship`, `ImportPayload` in `domain/types.go`; `validateImportPayload` in `handlers.go`
#### 6.13.3 ✅ `db.CreateGraph` — single transaction, server-assigned UUID, batch insert chars + rels
#### 6.13.4 ✅ `db.ReplaceGraph` — single transaction, UPDATE series + DELETE chars (cascades) + batch insert
#### 6.13.5 ✅ `POST /api/series` → `201 { id }`
#### 6.13.6 ✅ `PATCH /api/series/:id` → `200 Series`; 404 guard; validation
#### 6.13.7 ✅ Store interface + PGStore wrappers; routes registered; PATCH added to CORS; router test updated
#### 6.13.8 ✅ `src/lib/importPayload.ts`: `ImportPayload`, `isBackendId`, `graphSnapshotToImport` (UUID memo), `applyIdRemap`; `mutate` helper + `createGraph` + `patchGraph` in `client.ts`
#### 6.13.9 ✅ `handleSaveGraph` async: immediate local save + async POST/PATCH; `applyIdRemap` after POST to stabilise IDs
#### 6.13.10 — Future: debounced auto-save, "Saving…" indicator

---

---

### 6.14 — Bidirectional LTG Sync

> The code editor and the canvas stay in sync. Canvas → code (on demand and live) is
> complete. Code → canvas (via Render) is complete. Remaining work: surgical diffs,
> block label round-tripping, and the Edit Timeline visual tool.

#### 6.14.0 — Foundation ✅
- [x] `compiledToFullSnapshot` in `ltgCompiler.ts` — Render in edit mode converts `CompileSuccess` → full unfiltered `GraphSnapshot`; sets it as `editGraph`; advances `editBaseRef` (treated as a clean save point)
- [x] `snapshotToAst` / `graphSnapshotToLtg` in `ltgEmitter.ts` — emits valid LTG from any `GraphSnapshot`; uses `ltgIdentifier` when present, derives slug from character name for canvas-created nodes; handles unlinks, deceased, all metadata fields including custom tags
- [x] "Code Editor" button in edit toolbar always re-emits from `editGraph` on every click (canvas → code on demand, not a simple toggle); `handleOpenCodeEditorFromEdit` in `App.tsx`
- [x] `SideToolbar` stays visible when the editor panel is open in edit mode so the Code Editor button remains accessible

#### 6.14.1 — Live canvas → code sync ✅
- [x] `syncContent?: string | null` prop added to `CodeEditorPanel` (separate from one-shot `externalContent`) — replaces the document while preserving cursor position via `EditorSelection.single` clamped to the new document length; notifies LSP via `didChange`
- [x] 500 ms debounced `useEffect` in `App.tsx` on `[editGraph, editMode, editorOpen]` — calls `graphSnapshotToLtg(editGraph)` and sets `editorSyncContent`
- [x] `skipSyncUntilRef` set to `Date.now() + 1000` inside `handleCompileAndRender` — suppresses the sync for 1 s after a Render so the user's source is not immediately overwritten with a re-emission
- [x] "↻ synced" text flashes in the editor header for 1.5 s after each auto-update

#### 6.14.2 — Incremental line diff (surgical edits) ✅
- [x] `src/lib/ltgDiff.ts`: `computeLtgChanges(oldText, newText): ChangeSpec[]` — LCS-based line-level diff; `ChangeSpec[]` is CodeMirror's type (character-offset hunks) — compatible, not Monaco
- [x] Edge cases handled: pure append (prepends `\n` when file doesn't end with newline), delete-at-end (includes the preceding `\n` separator), middle replacements, non-contiguous multi-hunk changes
- [x] `CodeEditorPanel` `syncContent` effect now uses `computeLtgChanges(view.state.doc.toString(), syncContent)` — CodeMirror auto-adjusts cursor for unchanged regions; no explicit selection remapping needed
- [x] 14 unit tests covering all edge cases in `src/__tests__/ltgDiff.test.ts`

#### 6.14.3 — Block label and group structure round-trip ✅
- [x] `BlockGroup` type added to `domain.ts`; `Series` gains `blockLabels?: Record<number, string>` and `blockGroups?: readonly BlockGroup[]`
- [x] `extractBlockMeta(rawBlocks)` helper in `ltgCompiler.ts` builds both fields from `CompileSuccess.blocks`; called from both `compiledToSnapshot` and `compiledToFullSnapshot`
- [x] Persistence is automatic — both fields live inside `Series` inside `GraphSnapshot`, which is already serialised by `saveEditGraph`/`saveViewerGraph`
- [x] `snapshotToAst` in `ltgEmitter.ts` now emits `new chapter: "The Storm"` and `group "Season 1":` when labels/groups are present; falls back to unlabelled blocks for canvas-created graphs

#### 6.14.4 — Edit Timeline tool (block labels + arc grouping)
- [ ] Wire the "Edit Timeline" stub button in the edit toolbar to a slide-in overlay (or inline timeline UI)
- [ ] Allow the user to assign a display label to any individual block (e.g. "The Storm" for chapter 6)
- [ ] Allow the user to define named arc / volume / season groups over consecutive block ranges
- [ ] Persist the result in `editGraph` (via 6.14.3 metadata fields) and round-trip through `snapshotToAst`

---

## Future Phases (later)

### Edit Existing Backend Graphs
Load any persisted series into edit mode (not just canvas-created ones). Re-use `GET /series/:id/graph/full` as the edit base; `PATCH /api/series/:id` to write back.

### Character Rename Events in Canvas
Track name changes through canvas UI — adds `rename` statements to emitted LTG source.

### ~~Edit Existing Backend Graph (full fidelity)~~ ✅ (resolved in 6.2)
`useFullGraph` hook consumes `GET /graph/full`; `handleToggleEditMode` uses it as the edit base.
