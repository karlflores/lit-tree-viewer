# Graph Layout Algorithm — LitTree

> This document specifies the ranked force layout algorithm that replaces the
> Dagre-based layout used in the initial implementation. It is the authoritative
> reference for implementers.

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
Input: nodes[], edges[]
              │
      ┌───────▼────────┐
      │  Phase 1        │  Rank assignment (topological, directed edges only)
      │  assignRanks()  │
      └───────┬────────┘
              │ ranks: Map<id, number>
      ┌───────▼────────┐
      │  Phase 2        │  Initial x/y positions (degree-weighted columns)
      │  initialLayout()│
      └───────┬────────┘
              │ positions: Map<id, {x, y}>
      ┌───────▼────────┐
      │  Phase 3        │  Force-directed refinement (spacing + edge length)
      │  refineLayout() │
      └───────┬────────┘
              │ positions: Map<id, {x, y}>
      ┌───────▼────────┐
      │  savedPositions │  Override with user-dragged positions from localStorage
      │  override       │
      └───────┬────────┘
              │
         Output: Node[] with final positions
```

When **new nodes appear** (chapter scrub forward) and existing nodes already have
positions, only Phase 4 (incremental placement) runs — existing nodes are not moved.

---

## Phase 1 — Rank Assignment

**Goal:** Assign each node an integer `rank` (0, 1, 2, …) that respects the
directed-edge hierarchy. Nodes with lower rank appear higher on the canvas.

### Algorithm: Longest-Path Layering

```
1. Build a directed adjacency list from directed edges only.
   Undirected edges are ignored in this phase.

2. Compute in-degree for each node in the directed subgraph.

3. Find roots: nodes with in-degree = 0.
   If no roots exist (all nodes are in cycles), use the node with
   the highest total degree as a synthetic root.

4. BFS from roots, assigning ranks by longest path:
     rank[root] = 0
     for each node n in topological order:
       for each successor s of n:
         rank[s] = max(rank[s], rank[n] + 1)

5. Cycle handling:
   If a directed cycle is detected during the BFS:
     - Identify the back-edge (the edge creating the cycle).
     - Remove it from the directed graph for rank computation only
       (it is still drawn as a normal edge).
     - Record it so Phase 3 can still apply attraction along it.

6. Nodes with NO directed edges (isolated or undirected-only):
     a. If the node has undirected-edge neighbours that already have ranks:
          rank[n] = round(average of neighbour ranks)
     b. Otherwise: rank[n] = 0
        These nodes are placed in a "floating" layer at the top.
```

**Output:** `Map<nodeId, rank>`

### Why Longest-Path (not shortest-path)?

Shortest-path layering (rank = min predecessor rank + 1) tends to compress the
hierarchy — a character introduced late may get rank 1 even if they are several
hops from a root. Longest-path ensures that the vertical position of a character
reflects the full chain of directed relationships above them.

---

## Phase 2 — Initial Position Assignment

**Goal:** Translate ranks into (x, y) coordinates. Nodes in the same rank form a
horizontal row. Within each row, high-degree nodes are centred.

### Y positions

```
y[n] = rank[n] * RANK_HEIGHT
```

`RANK_HEIGHT` is a constant (200 px). Floating nodes (rank 0, no directed edges)
share the top row with genuine roots.

### X positions

```
For each rank row:
  1. Sort nodes by total degree (in-degree + out-degree across ALL edges)
     in descending order.
     → High-degree characters (protagonists) go to the centre of their row.

  2. Assign column indices: 0, 1, 2, … left-to-right.
     Centre the row by offsetting:
       x[i] = (i - (count - 1) / 2) * COLUMN_SPACING

     COLUMN_SPACING = max(MIN_NODE_DIST, 20 * avg_degree_in_row)
     → Rows with more connections between nodes are spread wider
       to reduce visual crossing before the force pass.

  3. Barycentric crossing reduction (2 passes):
     For each adjacent pair in the row, if swapping them reduces the
     number of crossings with the row above or below, swap them.
     Repeat twice. This is a standard sweep heuristic — cheap and
     effective for small graphs.
```

**Output:** initial `Map<nodeId, {x, y}>`

---

## Phase 3 — Force-Directed Refinement

**Goal:** Enforce minimum separation between all node pairs, pull connected nodes
toward their target edge length, and keep each node near its assigned rank row.

Runs for a fixed number of iterations (50–80) or until convergence (max
displacement < 0.5 px).

### Forces

#### 1. Repulsion (all pairs)

```
F_repel = REPULSION_STRENGTH / distance²
direction: radially away from the other node
```

If `distance < MIN_NODE_DIST / 2`, apply a hard push:

```
F_repel = REPULSION_STRENGTH * 10  (strong enough to always separate)
```

Complexity: O(n²) per iteration — acceptable for graphs up to ~200 nodes.
For larger graphs, use a Barnes-Hut quadtree approximation.

#### 2. Attraction (edges only)

```
F_attract = SPRING_K * (distance - TARGET_EDGE_LENGTH)
direction: along the edge toward the other endpoint
```

Applied only to pairs that share an edge. Directed edges use a higher
spring constant than undirected edges (they carry more structural signal):

```
directed:   SPRING_K * 1.5
undirected: SPRING_K * 1.0
```

#### 3. Rank anchoring (vertical soft constraint)

```
F_anchor_y = ANCHOR_K * (y_current - rank * RANK_HEIGHT)
direction: toward the node's assigned rank row (y-axis only)
```

This is the key force that preserves the topological hierarchy while allowing
the force pass to work within each rank row. `ANCHOR_K` is kept deliberately
low so it does not override the force-directed spacing.

#### 4. Centre gravity (prevents drift)

```
F_gravity = GRAVITY_K * distance_from_canvas_centre
direction: toward (0, 0)
```

Prevents disconnected sub-clusters from drifting off-screen.

### Integration

Euler integration with velocity damping:

```
for each iteration:
  for each node n:
    compute net force F_n (sum of all above)
    velocity[n] += F_n * dt
    velocity[n] *= DAMPING
    position[n] += velocity[n]

  converged = max(|velocity[n]|) < CONVERGENCE_THRESHOLD
  if converged: break
```

### Constants

| Constant | Value | Notes |
|---|---|---|
| `MIN_NODE_DIST` | 180 px | Hard minimum between any two node centres |
| `TARGET_EDGE_LENGTH` | 160 px | Ideal distance for connected pairs |
| `RANK_HEIGHT` | 200 px | Vertical gap between rank rows |
| `COLUMN_SPACING` | max(180, degree×20) px | Horizontal gap within a rank row |
| `REPULSION_STRENGTH` | 8 000 | Scales up with node count (×1 per 10 nodes above 20) |
| `SPRING_K` | 0.04 | Edge attraction spring constant |
| `ANCHOR_K` | 0.15 | Rank-row anchoring strength |
| `GRAVITY_K` | 0.01 | Centre-pull constant |
| `DAMPING` | 0.85 | Velocity damping per iteration |
| `dt` | 1.0 | Time step (dimensionless) |
| `MAX_ITERATIONS` | 80 | Hard cap on force iterations |
| `CONVERGENCE_THRESHOLD` | 0.5 px | Stop early if all velocities below this |

---

## Phase 4 — Incremental New Node Placement

**Goal:** When the chapter scrubber advances and new characters appear, place them
near their existing neighbours without moving any already-positioned node.

This phase replaces a full re-layout for structural changes where existing nodes
already have persisted (dragged or previously laid-out) positions.

### Trigger condition

```
structureKey has changed (new node IDs present)
AND at least one existing node has a saved position
```

### Algorithm

```
For each new node n (nodes not in existingPositions):

  neighbours = all nodes connected to n by any edge

  if neighbours is non-empty:
    seed = average position of neighbours that have positions
    
    // Find the direction with the most open space
    directions = 8 cardinal + diagonal directions (0°, 45°, 90°, …, 315°)
    for each direction d:
      score[d] = count of existing nodes within (MIN_NODE_DIST * 2)
                 in a 90° cone around d from seed
    best_direction = direction with lowest score
    
    candidate = seed + best_direction * TARGET_EDGE_LENGTH

    // Resolve any remaining overlap by nudging outward
    while any existing node is within MIN_NODE_DIST of candidate:
      candidate += best_direction * 20

  else:
    // No neighbours — place at the least-dense periphery
    divide canvas bounding box into a 4×4 grid
    pick the cell with fewest nodes
    candidate = centre of that cell + small random jitter

  existingPositions[n.id] = candidate

// After all new nodes are placed, run 20 force iterations
// with existing nodes frozen as immovable anchors.
runForceIterations(positions, frozenIds = existingIds, iterations = 20)
```

**Output:** positions for new nodes only; existing positions unchanged.

---

## Auto-Layout

An **Auto Layout** button in the UI triggers a full Phase 1–3 re-layout, ignoring
all saved positions. This is useful when the user has manually arranged nodes into
a messy state, or after importing a large graph.

Behaviour:
1. Clear `savedPositions` for the current series from localStorage.
2. Run Phases 1–3 on the current node/edge set.
3. Write results to `layoutNodes` — the animation hook transitions all nodes to
   their new positions over 500 ms.

The button lives in `ZoomControls` (bottom-right of the canvas) alongside Zoom In,
Zoom Out, and Fit View.

---

## Edge Rendering Notes

The layout algorithm positions nodes. Edge rendering is handled separately in
`RelationshipEdge.tsx`, but the layout influences edge clarity:

- **Straight edges** should be the default for all relationship types.
  React Flow's `StraightEdge` or a custom SVG path from source handle centre
  to target handle centre, with no bezier control points.
- **Parallel edges** (two or more edges between the same pair of nodes) should
  be slightly offset (perpendicular to the straight line) to remain individually
  readable. Offset amount: 12 px per parallel edge, applied symmetrically.
- The force refinement's `TARGET_EDGE_LENGTH` naturally separates connected
  pairs enough that labels can be placed at the edge midpoint without overlap.

---

## File Structure

```
frontend/src/lib/layout.ts         ← replaces the current Dagre implementation
  assignRanks()
  initialLayout()
  refineLayout()
  placeNewNodes()
  applyLayout()                    ← top-level entry point (replaces applyDagreLayout)

frontend/src/components/
  GraphCanvas.tsx                  ← add handleAutoLayout callback, pass to ZoomControls
  ZoomControls.tsx                 ← add Auto Layout button
```

---

## Testing Strategy

Each phase is a pure function operating on plain data structures — all are unit-testable
without a DOM or React Flow instance.

| Test file | Coverage |
|---|---|
| `layout.test.ts` (already exists) | Extend with Phase 1–4 tests |
| Phase 1 | Roots identified correctly; ranks respect longest path; cycles handled |
| Phase 2 | High-degree node is centred; rows spaced by `COLUMN_SPACING` |
| Phase 3 | No pair closer than `MIN_NODE_DIST` after refinement; convergence within `MAX_ITERATIONS` |
| Phase 4 | New node placed ≥ `MIN_NODE_DIST` from all existing; neighbours within 2× `TARGET_EDGE_LENGTH` |
