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
- **Non-destructive entry.** Entering edit mode on an existing graph does not alter
  the viewed graph. "New Graph" always starts a blank canvas.
- **Chapter-scoped mutations.** Every canvas action (add node, draw relationship,
  mark deceased) is applied at the currently selected chapter. The timeline scrubber
  remains active in edit mode.

---

## Application Modes

| Mode | Triggered by | Graph source |
|---|---|---|
| **View mode** | Default on load | Backend API |
| **Editor view mode** | "Open in Editor" → Render | LTG compiler (`CompileSuccess`) |
| **Edit mode (existing)** | "Edit Mode" button *(future)* | Current snapshot (read from backend) |
| **Edit mode (new graph)** | "New Graph" button | Empty `EditableGraph` in `sessionStorage` |

For Phase 6 (this document), only the **new graph** path is in scope. Editing an
existing backend graph requires a `GET /api/series/:id/export` round-trip that is
deferred to a later phase.

---

## Data Model

### `EditableGraph`

A flat, self-contained representation that lives purely in the frontend. It is
structurally equivalent to the backend domain model but uses client-generated IDs
and does not require a backend round-trip to create.

```typescript
type EditableGraph = {
  id:            string           // 'edit:<nanoid>' — never a real UUID
  title:         string
  mediaType:     MediaType        // 'book' | 'show' | 'film'
  unitLabel:     string           // 'Chapter' | 'Episode' | 'Part'
  totalUnits:    number           // grows as chapters are added
  characters:    EditableCharacter[]
  relationships: EditableRelationship[]
}

type EditableCharacter = {
  id:           string            // 'char:<nanoid>'
  name:         string
  aliases:      string[]
  description:  string | null
  imageUrl:     string | null
  introducedAt: number            // chapter this character was added in edit mode
  diedAt:       number | null
}

type EditableRelationship = {
  id:           string            // 'rel:<nanoid>'
  fromId:       string
  toId:         string
  label:        string
  kind?:        RelationshipKind
  directed:     boolean
  introducedAt: number
  endedAt:      number | null
}
```

`EditableGraph` converts to a `GraphSnapshot` via `editableToSnapshot(graph, atUnit)`
— structurally identical to `compiledToSnapshot` but for this lighter type.

### Session Storage

Key: `litree:edit-graph`  
Value: `JSON.stringify(EditableGraph)`

Helpers in `src/lib/editGraphSession.ts`:
- `saveEditGraph(graph)` — write to sessionStorage
- `loadEditGraph()` — read and parse; returns `null` on miss or parse error
- `clearEditGraph()` — remove the key
- `createEmptyGraph()` — factory for a blank graph (`totalUnits: 1`, no characters)

---

## UI Changes

### Viewer Toolbar (view mode)

Two buttons are added below "Edit Mode":

| Button | Action |
|---|---|
| **Edit Mode** *(existing)* | Toggle `editMode` on the current backend graph *(future)* |
| **New Graph** | Create a blank `EditableGraph`, enter edit mode |

"New Graph" is always available. It starts a completely fresh canvas regardless of
what is currently displayed.

### Header — Editable Title

When in edit mode the series title in the header becomes an inline `<input>`:

```
◈ LitTree  ·  [___ Untitled ___]           Chapter 1
```

- Placeholder text: `"Untitled"`
- Clicking outside or pressing Enter/Escape commits the value
- Updates `editGraph.title` in state (and re-saves to sessionStorage)
- The `·` separator and chapter indicator remain unchanged

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

The scrubber remains functional: `currentUnit` can be changed, which affects which
chapter future node-add and relationship-draw operations target. "Add Chapter"
functionality (incrementing `totalUnits`) is a **Phase 6.2** feature.

---

## State Flow

```
App.tsx state
  editMode: boolean            — true when in edit mode
  editGraph: EditableGraph | null  — non-null only while in edit mode

  snapshot (derived):
    if editGraph != null      → editableToSnapshot(editGraph, currentUnit)
    else if localGraph != null → compiledToSnapshot(localGraph, currentUnit)
    else                       → graphData.snapshot (backend)

  layoutSnapshot (derived):
    same priority, always at totalUnits
```

When `editGraph` is set, the backend graph data is still fetched in the background
(React Query cache) but not displayed. Exiting edit mode restores the view.

---

## Phased Task Breakdown (Phase 6)

### 6.1 — Data Model & Session Helpers *(implement first)*
- [ ] Create `src/types/editGraph.ts` with `EditableGraph`, `EditableCharacter`, `EditableRelationship`
- [ ] Create `src/lib/editGraphSession.ts`: `createEmptyGraph`, `saveEditGraph`, `loadEditGraph`, `clearEditGraph`
- [ ] Create `src/lib/editableToSnapshot.ts`: pure function `editableToSnapshot(graph, atUnit) → GraphSnapshot`
- [ ] Unit-test `editableToSnapshot`: empty graph, single character, character with diedAt, relationship visibility

### 6.2 — App-Level State & Snapshot Derivation
- [ ] Add `editGraph: EditableGraph | null` state to `App.tsx`
- [ ] Add `handleNewGraph()`: create empty graph, set `editGraph`, set `editMode = true`, reset `currentUnit = 1`
- [ ] Add `handleSaveGraph()`: call `saveEditGraph(editGraph)`, emit a "Saved" toast notification
- [ ] Add `handleExitEdit()`: clear `editGraph` from state (keep sessionStorage), set `editMode = false`
- [ ] Update snapshot derivation: `editGraph` takes highest priority over `localGraph` and backend data
- [ ] Load any in-progress edit graph from sessionStorage on mount (resume an interrupted session)

### 6.3 — "New Graph" Button in Viewer Toolbar
- [ ] Add "New Graph" `ToolbarButton` to `SideToolbar` in `App.tsx` (below "Edit Mode")
- [ ] Wire `onClick` to `handleNewGraph`
- [ ] Icon: a blank canvas / document icon

### 6.4 — Editable Title in Header
- [ ] When `editMode && editGraph != null`, render an `<input>` instead of the `<span>` for the series title
- [ ] Style: transparent background, white text, subtle underline or border-bottom on focus, same font as the span
- [ ] On change: update `editGraph.title` in state
- [ ] On blur / Enter / Escape: commit value; if empty, reset to `"Untitled"`

### 6.5 — Edit Toolbar
- [ ] Create `src/components/EditToolbar.tsx` with Save, New Node, Exit buttons
- [ ] Pass `onSave`, `onNewNode`, `onExit` props
- [ ] In `App.tsx`, swap `SideToolbar` children: `editMode ? <EditToolbar /> : <ViewerToolbar />`
- [ ] The existing viewer buttons (Menu, Edit Mode, Open in Editor, Code Editor) move into a named `<ViewerToolbar>` component or inline block for clarity

### 6.6 — New Node on Canvas
- [ ] Add `onAddCharacter?: (character: EditableCharacter) => void` prop to `GraphCanvas`
- [ ] In `GraphCanvas`, expose a `handleAddNode` that:
  1. Reads current viewport centre via `useReactFlow().screenToFlowPosition`
  2. Creates an `EditableCharacter` stub (empty name, `introducedAt = currentUnit`)
  3. Calls `onAddCharacter` with the stub
- [ ] `EditToolbar` "New Node" button calls `GraphCanvas` handler via a forwarded ref or a prop callback routed through `App.tsx`
- [ ] In `App.tsx`, `handleAddCharacter(char)`: append to `editGraph.characters`, re-derive snapshot
- [ ] Save updated graph to sessionStorage

### 6.7 — Inline Name Prompt for New Nodes
- [ ] Add `pendingNodeId: string | null` state to `GraphCanvas` (set when a node is freshly added)
- [ ] `CharacterNode` accepts an `isNaming?: boolean` data field
- [ ] When `isNaming`, render an `<input>` over the node label instead of the name text
- [ ] On Enter or blur: call `onCommitName(id, name)` prop; clear `pendingNodeId`
- [ ] On Escape: call `onCancelNode(id)` — removes the node from `editGraph`

### 6.8 — Empty Canvas State
- [ ] In `GraphCanvas`, when `editMode && nodes.length === 0`, render a centred hint overlay:
  `"Click New Node to add your first character"`
- [ ] Hint disappears as soon as the first node exists

### 6.9 — Timeline (New Graph)
- [ ] When `editGraph != null`, `TimelineScrubber` receives `series` derived from `editGraph`
  (`totalUnits: 1` for a new graph, grows as chapters are added in later phases)
- [ ] The scrubber renders correctly for a single-chapter graph (single dot / no range)

---

## Future Phases (out of scope for 6.x initial)

### 6.x — Add / Edit Relationships
- Drag between node handles to draw a new relationship
- Clicking an edge in edit mode opens an edge properties popover (label, directed toggle, kind)
- Delete edge via context menu or Delete key

### 6.x — Right-Click Node Context Menu
- Toggle deceased at current chapter
- Edit display name
- Rename at unit (adds rename event preserving history)
- Delete character (with confirmation; cascades relationships)

### 6.x — Add / Remove Chapters
- "Add Chapter" increments `totalUnits`; scrubber grows
- Chapter labels visible as ticks on the scrubber

### 6.x — Edit Existing Backend Graph
- "Edit Mode" on an existing graph fetches `GET /api/series/:id/export`, converts to `EditableGraph`
- Changes diff'd against the original and POSTed to `POST /api/import`

### 6.x — Backend Persistence
- `POST /api/series` — create series
- `POST /api/import` — upsert characters + relationships
- Save button posts the full `EditableGraph` converted to the import payload

### 6.x — Bidirectional LTG Sync
- Canvas mutations produce LTG AST diffs; code editor reflects changes in real time
- LTG source edits update the canvas without full re-compile
