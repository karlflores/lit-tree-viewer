# Graph Layout Algorithm — LitTree

> Authoritative reference for the ranked force layout implemented in
> `frontend/src/lib/layout.ts`. Update this document whenever constants or
> algorithm behaviour change.

---

## Motivation

Dagre is designed for strict DAGs (flow diagrams, dependency graphs). Character
relationship graphs have different properties that make Dagre a poor fit:

- Many edges are **undirected** (friends, siblings, rivals) — Dagre treats them as
  directed, corrupting the rank assignment.
- **Hub characters** (protagonists) should visually dominate, but Dagre gives all
  nodes equal visual weight.
- When new characters appear mid-story, a full Dagre re-layout **shuffles all
  existing nodes**, losing the user's mental map.
- Dagre does not enforce a **minimum separation** between nodes, so low-connectivity
  characters can be placed very close together or even overlapping.

The replacement algorithm — **Ranked Force Layout** — combines a topological rank
assignment (for hierarchy) with a force-directed refinement pass (for spacing), and
an incremental placement strategy for new nodes.

---

## High-Level Pipeline

```
Input: layoutSnapshot (final chapter — full character set)
              │
      ┌───────▼────────┐
      │  Phase 1        │  Rank assignment (topological, directed edges only)
      │  assignRanks()  │
      └───────┬────────┘
              │ ranks: Map<id, number>
      ┌───────▼────────┐
      │  Phase 2        │  Initial x/y positions (degree-weighted columns +
      │  initialLayout()│  crossing minimisation)
      └───────┬────────┘
              │ positions: Map<id, {x, y}>
      ┌───────▼────────┐
      │  Phase 3        │  Force-directed refinement (spacing + edge length +
      │  refineLayout() │  node-edge separation + hard separation passes)
      └───────┬────────┘
              │ positions: Map<id, {x, y}>
      ┌───────▼────────┐
      │  savedPositions │  Override with user-dragged positions from localStorage
      │  override       │
      └───────┬────────┘
              │
         Output: Node[] with final positions (all chapters)
```

**Layout is always computed on the final chapter** (complete character set) so that
positions are stable across every timeline unit. Earlier chapters simply hide nodes
that have not yet been introduced — positions are never re-computed on scrub.

When the full-graph structure has not changed but only new nodes need placing (e.g.
on an auto-layout after adding characters), **Phase 4** (incremental placement) runs
instead of a full Phases 1–3 re-run.

---

## Phase 1 — Rank Assignment

**Goal:** Assign each node an integer `rank` (0, 1, 2, …) that respects the
directed-edge hierarchy. Nodes with lower rank appear higher on the canvas.

### Algorithm: Longest-Path Layering

```
1. Build a directed adjacency list from directed edges only.
   Undirected edges are ignored in this phase.

2. Detect and remove back-edges with iterative DFS (grey-coloring) so the
   directed subgraph is a DAG for rank computation.
   Removed edges are still drawn; they just do not influence ranks.

3. Compute in-degree for each node in the DAG.

4. Find roots: nodes with in-degree = 0 in the DAG.
   If no roots exist (all nodes were in cycles), use the highest-total-degree
   node as a synthetic root.

5. BFS from roots, assigning ranks by longest path:
     rank[root] = 0
     for each node n in topological order:
       for each successor s of n:
         rank[s] = max(rank[s], rank[n] + 1)

6. Nodes with NO directed edges (isolated or undirected-only):
     a. If the node has undirected-edge neighbours that already have ranks:
          rank[n] = round(average of neighbour ranks)
     b. Otherwise: rank[n] = 0
```

**Output:** `Map<nodeId, rank>`

### Why Longest-Path?

Shortest-path layering compresses the hierarchy — a character introduced late may
get rank 1 even if they are several hops from a root. Longest-path ensures vertical
position reflects the full chain of directed relationships above a character.

---

## Phase 2 — Initial Position Assignment

**Goal:** Translate ranks into (x, y) coordinates. Nodes in the same rank form a
horizontal row. Within each row, high-degree nodes are centred, and edge crossings
are minimised before the force pass begins.

### Y positions

```
y[n] = rank[n] * RANK_HEIGHT
```

### X positions

```
For each rank row:
  1. Sort nodes by total degree (all edges, both directions) descending.
     Re-arrange the sorted list centre-out so the highest-degree node
     lands at the centre of the row and lower-degree nodes radiate outward.

  2. Assign positions:
       x[i] = (i - (count - 1) / 2) * COLUMN_SPACING

     COLUMN_SPACING = max(MIN_NODE_DIST, 20 * avg_degree_in_row)
```

### Crossing Minimisation

After initial placement, 5 rounds of Sugiyama-style sweeps reduce edge crossings:

```
Each round:
  1. Forward sweep  (rank 0 → max): reorder each row by barycenter of
     neighbours in the row above.
  2. Backward sweep (rank max → 0): reorder each row by barycenter of
     neighbours in the row below.
  3. Greedy adjacent-swap pass: for each row, try all neighbouring swaps;
     keep a swap only when it strictly reduces the total crossing count
     with both adjacent rows.
```

**Output:** initial `Map<nodeId, {x, y}>`

---

## Phase 3 — Force-Directed Refinement

**Goal:** Enforce minimum separation between all node pairs, pull connected nodes
toward their target edge length, keep each node near its assigned rank row, and
push nodes away from edges they are not connected to.

Runs for up to `MAX_ITERATIONS` (80) or stops early when max velocity drops
below `CONVERGENCE_THRESHOLD` (0.5 px).

### Forces (applied each iteration)

#### 1. Repulsion (all pairs)

```
F_repel = REPULSION_STRENGTH / distance²
direction: radially away from the other node

If distance < MIN_NODE_DIST / 2  (very close):
  F_repel = REPULSION_STRENGTH * 10 / distance²
```

#### 2. Attraction (edges only)

```
F_attract = SPRING_K * (distance - TARGET_EDGE_LENGTH)
direction: along the edge toward the other endpoint

directed edges:   SPRING_K × 1.5
undirected edges: SPRING_K × 1.0
```

#### 3. Rank anchoring (vertical soft constraint)

```
F_anchor_y = ANCHOR_K * (rank * RANK_HEIGHT - y_current)
direction: toward the node's assigned rank row (y-axis only)
```

Preserves topological hierarchy while the force pass adjusts within-row spacing.

#### 4. Centre gravity (prevents drift)

```
F_gravity_x = GRAVITY_K * -x
F_gravity_y = GRAVITY_K * -y
direction: toward origin (0, 0)
```

Prevents disconnected sub-clusters from drifting off-screen.

#### 5. Node-edge repulsion (routing clarity)

For each movable node, if it lies within `MIN_NODE_EDGE_DIST` of any edge it is
not connected to, push it away from the closest point on that edge segment:

```
If dist(node, edge_segment) < MIN_NODE_EDGE_DIST:
  F_node_edge = NODE_EDGE_REPULSION * (MIN_NODE_EDGE_DIST - dist) / dist
  direction: away from closest point on segment
```

This reduces the frequency of nodes visually sitting on top of unrelated edges.

### Integration

Euler integration with velocity damping and per-step displacement clamping:

```
for each iteration:
  for each node n:
    compute net force F_n (sum of all above)
    velocity[n] = (velocity[n] + F_n) * DAMPING
    clamp |velocity[n]| to MAX_STEP  ← prevents nodes flying off at simulation start
    position[n] += velocity[n]

  if max(|velocity[n]|) < CONVERGENCE_THRESHOLD: break
```

### Post-processing: Hard Separation Passes

After the force loop, two separate hard-correction passes guarantee constraints
regardless of whether the simulation fully converged:

1. **Node-node separation** (30 passes): any pair closer than `MIN_NODE_DIST` is
   pushed apart by exactly the overlap amount + 1 px safety margin.
2. **Node-edge separation** (20 passes): any non-adjacent node within
   `MIN_NODE_EDGE_DIST` of an edge segment is pushed away perpendicularly.

### Constants

| Constant | Value | Rationale |
|---|---|---|
| `MIN_NODE_DIST` | 240 px | Hard floor between node centres. Node box is 120×72 px, so horizontal anchor gap ≥ 120 px and vertical gap ≥ 168 px — enough room for edge labels. |
| `TARGET_EDGE_LENGTH` | 200 px | Spring equilibrium. At 200 px centre-to-centre: 80 px horizontal edge visible, 128 px vertical edge visible. |
| `RANK_HEIGHT` | 220 px | Vertical gap between rank rows — matches `MIN_NODE_DIST` scale. |
| `REPULSION_STRENGTH` | 1 200 | Scaled down from initial spec to avoid divergence at close starts. |
| `SPRING_K` | 0.06 | Edge attraction constant. |
| `ANCHOR_K` | 0.20 | Rank-row anchoring strength (y-axis only). |
| `GRAVITY_K` | 0.05 | Centre-pull constant. Stronger than initial spec to keep graph compact. |
| `DAMPING` | 0.60 | Velocity retention per step. Lower than initial spec for faster dissipation and tighter convergence. |
| `MAX_STEP` | 80 px | Maximum displacement per node per iteration. Prevents nodes from flying off when forces are large at simulation start. |
| `MAX_ITERATIONS` | 80 | Hard cap on force iterations. |
| `CONVERGENCE_THRESHOLD` | 0.5 px | Early-exit when max velocity is below this. |
| `MIN_NODE_EDGE_DIST` | 60 px | Minimum distance from a node centre to any non-adjacent edge. |
| `NODE_EDGE_REPULSION` | 800 | Magnitude of the node-edge repulsion force. |

---

## Phase 4 — Incremental New Node Placement

**Goal:** When the auto-layout is triggered after new characters have been added,
place only the new nodes near their existing neighbours without moving any
already-positioned node.

### Trigger condition

```
at least one existing node has a saved position
AND new nodes are present (not in savedPositions)
```

### Algorithm

```
For each new node n:

  neighbours = all nodes connected to n by any edge

  if neighbours is non-empty:
    seed = average position of already-positioned neighbours

    // Find the direction with the most open space (fewest nodes in cone)
    for each of 8 directions (0°, 45°, 90°, …, 315°):
      score = count of nodes within MIN_NODE_DIST * 2 in a 90° cone
    best_direction = direction with lowest score

    candidate = seed + best_direction * TARGET_EDGE_LENGTH

    // Nudge outward until clear of all existing nodes
    repeat up to 50 times:
      if any existing node within MIN_NODE_DIST of candidate:
        candidate += best_direction * (overlap + 1)

  else:
    // No positioned neighbours — find the least-dense cell in a 4×4 grid
    divide canvas bounding box into 4×4 grid
    candidate = centre of cell with fewest nearby nodes

  savedPositions[n.id] = candidate

// Run Phase 3 with all pre-existing nodes frozen as anchors (20 iterations)
refineLayout(positions, frozenIds = existingIds)
```

---

## Position Caching and Timeline Stability

After every layout computation (Phases 1–3 or Phase 4), **all resulting positions
are written back into `savedPositionsRef`**. This means:

- The force algorithm runs exactly once for the full graph (on first load or after
  an explicit auto-layout).
- When the user scrubs to an earlier chapter, every character in that chapter
  already has a cached position — `applyLayout` finds no new nodes and returns
  immediately without running any force iterations.
- User-dragged positions overwrite cached positions and are also persisted to
  `localStorage` under `litree:positions:<seriesId>`.

---

## Auto-Layout

An **Auto Layout** button in `ZoomControls` triggers a full Phase 1–3 re-layout on
the complete character set, ignoring all saved positions.

Behaviour:
1. Clear `savedPositionsRef` and `localStorage` entry for the series.
2. Run Phases 1–3 on `layoutRawNodes` and `layoutEdges` (always the full graph).
3. Write all new positions back to `savedPositionsRef`.
4. The `useAnimatedLayout` hook transitions all nodes to their new positions
   over ~500 ms.

---

## Edge Rendering — Bezier Curves with Closest-Anchor Heuristic

Edge rendering is handled in `RelationshipEdge.tsx`. The layout positions node
centres; the edge component independently computes where to attach.

### Anchor Points

Each node exposes **4 candidate anchor points** — the midpoints of its top,
bottom, left, and right sides — computed from the node's absolute canvas position
and measured dimensions (fallback: 120×72 px).

```
Top:    (cx,     ny)
Bottom: (cx,     ny + h)
Left:   (nx,     cy)
Right:  (nx + w, cy)
```

### Closest-Pair Heuristic

For each edge, all 16 combinations (4 source anchors × 4 target anchors) are
evaluated. The pair with the **minimum squared distance** is chosen. The winning
`Position` enum value (`Top`/`Bottom`/`Left`/`Right`) drives the direction of the
bezier control-point handle, so the curve exits and enters perpendicular to the
chosen face.

```
for s in source_anchors:
  for t in target_anchors:
    d² = (s.x - t.x)² + (s.y - t.y)²
    if d² < best: best = (s, t)

[edgePath, labelX, labelY] = getBezierPath({
  sourceX: best.s.x, sourceY: best.s.y, sourcePosition: best.s.position,
  targetX: best.t.x, targetY: best.t.y, targetPosition: best.t.position,
  curvature,
})
```

### Parallel Edges

Multiple edges between the same node pair attach to the same anchor points but
use different `curvature` values so they fan out visually:

```
curvature = BASE_CURVATURE + (parallelIndex - (parallelCount - 1) / 2) × PARALLEL_CURVATURE_STEP
BASE_CURVATURE        = 0.25
PARALLEL_CURVATURE_STEP = 0.35
```

---

## GraphCanvas Architecture

```
App.tsx
  ├─ useGraphData(SERIES_ID, currentUnit)    ← display snapshot (current chapter)
  ├─ useGraphData(SERIES_ID, totalUnits)     ← layout snapshot (final chapter, from cache)
  └─ <GraphCanvas snapshot layoutSnapshot />

GraphCanvas.tsx
  ├─ layoutRawNodes / layoutEdges            ← from layoutSnapshot (full graph)
  ├─ currentRawNodes                         ← from snapshot (current chapter, data sync only)
  ├─ visibleIds / visibleEdges               ← filtered by atUnit + showDeceased
  │
  ├─ Effect 1: layout  [layoutRawNodes, layoutEdges]
  │    structureKey changed → applyLayout → cache all positions
  │
  └─ Effect 2: data sync  [currentRawNodes]
       update node .data (name, alive/deceased, selection) — no position changes
```

---

## File Structure

```
frontend/src/lib/layout.ts
  assignRanks()        Phase 1 — exported for unit tests
  initialLayout()      Phase 2 — exported for unit tests
  refineLayout()       Phase 3 — exported for unit tests
  placeNewNodes()      Phase 4 — exported for unit tests
  applyLayout()        Top-level entry point (used by GraphCanvas)
  LAYOUT_CONSTANTS     All tunable constants in one object

frontend/src/components/
  GraphCanvas.tsx      layoutSnapshot prop; two-effect layout+data-sync pattern
  RelationshipEdge.tsx Bezier edges with closest-anchor heuristic
  ZoomControls.tsx     Auto Layout button
```

---

## Testing Strategy

Each phase is a pure function — all are unit-testable without a DOM or React Flow.

| Test file | Coverage |
|---|---|
| `layout.test.ts` | Phase 1–4 + `applyLayout` integration |
| Phase 1 | Roots identified; ranks respect longest path; cycle back-edge removed; isolated node gets rank 0 |
| Phase 2 | High-degree node centred; row width scales with degree |
| Phase 3 | No pair closer than `MIN_NODE_DIST` after refinement; converges within `MAX_ITERATIONS` |
| Phase 4 | New node ≥ `MIN_NODE_DIST` from all existing; placed near neighbours |
