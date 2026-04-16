# Known Bugs — LitTree

> Bugs identified through static code analysis. Each entry includes a description,
> reproduction steps, expected vs actual behaviour, and the affected code location.
> Update the status field as bugs are confirmed, fixed, or dismissed.

---

## BUG-001 — Characters stranded when removing the last chapter

**Status:** Open  
**Severity:** High  
**Area:** Edit mode — chapter management  
**File:** `frontend/src/App.tsx` — `handleRemoveChapter`

### Description

When a chapter is removed, `handleRemoveChapter` correctly clamps `diedAt` values
and prunes relationships whose `introducedAt` exceeds the new total. It does **not**
clamp `introducedAt` for characters. A character introduced in the removed chapter
stays in `editGraph.characters` with `introducedAt > totalUnits`. It will never
appear on the canvas and will produce an orphaned `new chapter:` block in the
emitted LTG source.

### Reproduction steps

1. Open the app and enter **Edit Mode**.
2. Add a first character (Chapter 1). Name it e.g. "Alice".
3. Click **Add Chapter** to create Chapter 2.
4. Advance the timeline scrubber to Chapter 2.
5. Click **New Node** and add a second character, e.g. "Bob".
6. Confirm Bob appears on the canvas at Chapter 2 and is absent at Chapter 1.
7. Click **Remove Chapter** to remove Chapter 2.
8. Scrub the timeline — verify Alice is still visible.
9. Open the **Code Editor** (edit toolbar) and inspect the emitted LTG source.

### Expected behaviour

- Bob is removed from the graph (or his `introducedAt` is clamped to Chapter 1).
- The LTG source contains no orphaned block for Chapter 2.

### Actual behaviour (predicted)

- Bob remains in `editGraph.characters` with `introducedAt = 2`, but is never
  visible because `totalUnits = 1`.
- The LTG source contains a `new chapter:` block (Chapter 2) with Bob's `actor`
  declaration, even though Chapter 2 no longer exists.

### Notes

The fix is to add a `characters.map` step inside `handleRemoveChapter` alongside
the existing `diedAt` clamp — filter out or clamp characters whose `introducedAt`
exceeds `newTotal`.

---

## BUG-002 — Relationship panel can be nullified by an orphaned timer

**Status:** Open  
**Severity:** Medium  
**Area:** Edit mode — panel state management  
**File:** `frontend/src/App.tsx` — `handleSelectCharacter` (line ~213)

### Description

`handleSelectCharacter` schedules a 250 ms timer to null out `panelRelationship`
whenever it opens the character panel (so the relationship panel can animate out
before its data disappears). However, it does not first cancel any existing
`relCloseTimerRef` from a previous call. If the user clicks two different character
nodes in rapid succession (faster than 250 ms), the first timer is orphaned. When
it fires it nullifies `panelRelationship` — which by that point may belong to a
freshly opened relationship panel, leaving it mounted but dateless.

### Reproduction steps

1. Enter **Edit Mode**.
2. Add at least two characters and draw a relationship edge between them.
3. Click the edge to open the **Relationship Edit Panel**.
4. Quickly click **character A** (relationship panel begins sliding out).
5. Before the slide animation completes (~250 ms), quickly click **character B**.
6. Wait approximately 300 ms for both timers to fire.
7. Click the relationship edge again.

### Expected behaviour

The Relationship Edit Panel opens normally showing the edge's details.

### Actual behaviour (predicted)

The panel either fails to open, opens blank, or flickers — because `panelRelationship`
was nullified by the orphaned timer from step 4, leaving the edge panel mounted with
no data when step 7 triggers it.

### Notes

The fix is to add `if (relCloseTimerRef.current) clearTimeout(relCloseTimerRef.current)`
before the `relCloseTimerRef.current = setTimeout(...)` assignment on the character-open
path in `handleSelectCharacter`. The same pattern already exists correctly in
`handleSelectRelationship`.

---

## BUG-003 — Stale `pendingNodeId` survives edit mode exit and re-entry

**Status:** Open  
**Severity:** Low  
**Area:** Edit mode — node creation  
**File:** `frontend/src/components/GraphCanvas.tsx` — `pendingNodeId` state

### Description

`GraphCanvas` holds `pendingNodeId` in local component state to track which node
is currently awaiting an inline name. `doExitEdit` in `App.tsx` clears all
app-level edit state but cannot reach inside `GraphCanvas` to reset `pendingNodeId`.
If the user exits edit mode while a node is awaiting a name, the stale ID persists
across the mode transition. On re-entry the ID is unlikely to match any node
(the edit base is rebuilt fresh), but if the user had saved the graph with an
un-named node still present, the matching node would erroneously show the naming
input on re-entry.

### Reproduction steps

1. Enter **Edit Mode** (existing graph or new graph).
2. Click **New Node** — a node appears with the inline name input focused.
3. **Do not type a name.** Click **Exit Edit Mode** immediately while the input
   is still focused.
4. If an "unsaved changes" dialog appears, choose **Discard changes**.
5. Click **Edit Mode** again to re-enter.
6. Observe whether any node shows the inline naming input unexpectedly.

### Expected behaviour

No node shows the naming input on re-entry; all nodes are in their normal display
state.

### Actual behaviour (predicted)

In most cases this is visually harmless (the stale ID won't match any node in the
fresh edit base). The edge case to watch: if the user had previously saved the
un-named node (empty `name: ""`), that node will exist in the new edit base and
the stale `pendingNodeId` would match it, causing the naming input to appear
unexpectedly.

### Notes

The fix is to expose a reset callback from `GraphCanvas` (e.g. via a ref or a
prop) that `doExitEdit` can call, or to lift `pendingNodeId` into `App.tsx` state
so it is cleared alongside the other edit state.

---

## BUG-004 — EditTimelinePanel shows stale labels after a Render in edit mode

**Status:** Open  
**Severity:** Low  
**Area:** Edit mode — timeline panel / bidirectional sync  
**File:** `frontend/src/components/EditTimelinePanel.tsx` — `useEffect` sync (line ~47)

### Description

`EditTimelinePanel` resets its local label and group state only when `series.id`
or `series.totalUnits` changes. When the user clicks **Render** in the code editor
(while in edit mode), `handleCompileAndRender` replaces `editGraph` — including
`series.blockLabels` and `series.blockGroups` — with the compiled result. Because
`series.id` and `series.totalUnits` may not change, the panel's local inputs are
not resynced and continue to show the old values. If the user then clicks away
from any input (triggering a `commit`), the stale panel values overwrite the
freshly-rendered ones.

### Reproduction steps

1. Enter **Edit Mode** with a graph that has at least 3 chapters.
2. Open the **Edit Timeline** panel.
3. Assign labels to a couple of blocks, e.g. Chapter 2 → "The Beginning",
   Chapter 3 → "The Middle".
4. Open the **Code Editor** (edit toolbar).
5. In the LTG source, change the block labels to something different, e.g.
   `new chapter: "Part One"` and `new chapter: "Part Two"`.
6. Click **Render**.
7. Switch back to the **Edit Timeline** panel (without closing and reopening it).

### Expected behaviour

The timeline panel updates to reflect the newly rendered labels — "Part One" and
"Part Two".

### Actual behaviour (predicted)

The panel still shows "The Beginning" and "The Middle". Clicking into any input
and blurring will call `commit`, silently overwriting the rendered labels back
to the stale values.

### Notes

The fix is to add `series.blockLabels` and `series.blockGroups` to the `useEffect`
dependency array in `EditTimelinePanel`, or to use a deep-equality check so the
panel resyncs whenever the content of those fields changes (not just when `id` or
`totalUnits` changes).

---

## Template

```
## BUG-NNN — Short title

**Status:** Open | Confirmed | Fixed | Dismissed  
**Severity:** High | Medium | Low  
**Area:** ...  
**File:** ...

### Description
...

### Reproduction steps
1. ...

### Expected behaviour
...

### Actual behaviour (predicted / confirmed)
...

### Notes
...
```
