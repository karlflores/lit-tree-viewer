import Dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const NODE_WIDTH  = 120
const NODE_HEIGHT = 72

// ---------------------------------------------------------------------------
// Layout constants (see docs/layout-algorithm.md for rationale)
// ---------------------------------------------------------------------------

// Node box is 120 × 72 px (half-extents: 60 wide, 36 tall).
// "Anchor distance" = centre-to-centre distance minus the two half-extents on
// the chosen axis.  Edge labels need ≥ ~80 px of visible path to avoid being
// obscured by the node box they attach to.
//
//   MIN_NODE_DIST 240 → horizontal anchor gap: 240 - 120 = 120 px  ✓
//                       vertical   anchor gap: 240 -  72 = 168 px  ✓
//   TARGET_EDGE_LENGTH 200 → spring settles at 200 px centre-to-centre
//                       horizontal gap: 200 - 120 =  80 px  ✓
//                       vertical   gap: 200 -  72 = 128 px  ✓
export const LAYOUT_CONSTANTS = {
  MIN_NODE_DIST:         240,   // hard minimum between any two node centres (px)
  TARGET_EDGE_LENGTH:    200,   // ideal distance for connected pairs (px)
  RANK_HEIGHT:           220,   // vertical gap between rank rows (px)
  REPULSION_STRENGTH:   1200,   // Coulomb repulsion magnitude
  SPRING_K:             0.06,   // Hooke attraction spring constant
  ANCHOR_K:             0.20,   // rank-row anchoring strength (y-axis only)
  GRAVITY_K:            0.05,   // centre-pull constant (keeps graph compact)
  DAMPING:              0.60,   // velocity damping per integration step
  MAX_STEP:              80,    // maximum displacement per node per iteration (px)
  MAX_ITERATIONS:         80,   // hard cap on force iterations
  CONVERGENCE_THRESHOLD:  0.5,  // stop early when max velocity drops below this (px)

  MIN_NODE_EDGE_DIST:    60,    // minimum distance from a node centre to any non-adjacent edge (px)
  NODE_EDGE_REPULSION:   800,   // repulsion magnitude for the node-edge force
} as const

type Vec2 = { x: number; y: number }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Closest point on segment P1→P2 to point Q.
 * Returns [x, y, t] where t ∈ [0,1] is the parameter along the segment.
 */
function closestPointOnSegment(
  p1x: number, p1y: number,
  p2x: number, p2y: number,
  qx:  number, qy:  number,
): [number, number, number] {
  const dx    = p2x - p1x
  const dy    = p2y - p1y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 0.0001) return [p1x, p1y, 0]
  const t = Math.max(0, Math.min(1, ((qx - p1x) * dx + (qy - p1y) * dy) / lenSq))
  return [p1x + t * dx, p1y + t * dy, t]
}

function isDirected(edge: Edge): boolean {
  return !!(edge.data as { directed?: boolean } | undefined)?.directed
}

/**
 * Reorder an array so that element [0] lands at the centre index and
 * subsequent elements alternate right/left outward from the centre.
 * This ensures that the first (highest-degree) element is closest to x=0
 * after the centred column assignment.
 *
 * Example for n=6:  sorted=[a,b,c,d,e,f] → [f,d,b,a,c,e]
 *   indices:                                  0 1 2 3 4 5
 *   a lands at index 3 (centre-right of 6).
 */
function centerOut<T>(sorted: T[]): T[] {
  const n = sorted.length
  if (n <= 1) return sorted
  const result = new Array<T>(n)
  let lo = Math.floor((n - 1) / 2)
  let hi = lo + 1
  for (let i = 0; i < n; i++) {
    if (i % 2 === 0) result[lo--] = sorted[i]!
    else             result[hi++] = sorted[i]!
  }
  return result
}

/** Total degree (all edges, both directions). */
function buildDegreeMap(nodes: readonly Node[], edges: readonly Edge[]): Map<string, number> {
  const deg = new Map<string, number>()
  for (const n of nodes) deg.set(n.id, 0)
  for (const e of edges) {
    deg.set(e.source, (deg.get(e.source) ?? 0) + 1)
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1)
  }
  return deg
}

// ---------------------------------------------------------------------------
// Phase 1 — Rank Assignment
//
// Assigns each node an integer rank based on the directed-edge hierarchy.
// Lower rank = higher on the canvas (rank 0 at the top).
//
// Algorithm: longest-path layering on the DAG formed by directed edges.
//   1. Build directed adjacency; detect and remove back-edges (cycle breaker).
//   2. Find roots (in-degree = 0 in the DAG). Fall back to the
//      highest-total-degree node if all nodes are in a cycle.
//   3. BFS + longest-path: rank[s] = max(rank[s], rank[n] + 1).
//   4. Nodes not reachable from any directed edge get rank 0 or the rounded
//      average of their undirected-edge neighbours' ranks.
// ---------------------------------------------------------------------------

/** Remove back-edges from the directed subgraph so we get a DAG. */
function removeCycleEdges(
  nodes: readonly Node[],
  dirEdges: readonly Edge[],
): Set<string> {
  // Iterative DFS colouring: white=unvisited, grey=in-stack, black=done.
  const removed  = new Set<string>()
  const color    = new Map<string, 'white' | 'grey' | 'black'>()
  const stackSet = new Map<string, boolean>()

  // Build raw adjacency (multi-edge safe: first edge id wins)
  const adj  = new Map<string, string[]>()
  const eMap = new Map<string, string>() // "src->tgt" -> edge id

  for (const n of nodes) { adj.set(n.id, []); color.set(n.id, 'white') }
  for (const e of dirEdges) {
    adj.get(e.source)?.push(e.target)
    const key = `${e.source}->${e.target}`
    if (!eMap.has(key)) eMap.set(key, e.id)
  }

  for (const n of nodes) {
    if (color.get(n.id) !== 'white') continue

    // Iterative DFS
    const stack: Array<{ id: string; idx: number }> = [{ id: n.id, idx: 0 }]
    stackSet.set(n.id, true)
    color.set(n.id, 'grey')

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!
      const neighbours = adj.get(frame.id) ?? []

      if (frame.idx < neighbours.length) {
        const next = neighbours[frame.idx++]!
        if (color.get(next) === 'grey') {
          // Back-edge → cycle; remove it
          const eid = eMap.get(`${frame.id}->${next}`)
          if (eid) removed.add(eid)
        } else if (color.get(next) === 'white') {
          color.set(next, 'grey')
          stackSet.set(next, true)
          stack.push({ id: next, idx: 0 })
        }
      } else {
        color.set(frame.id, 'black')
        stackSet.set(frame.id, false)
        stack.pop()
      }
    }
  }

  return removed
}

/**
 * Phase 1: assign an integer rank to every node.
 * Exported for unit testing.
 */
export function assignRanks(
  nodes: readonly Node[],
  edges: readonly Edge[],
): Map<string, number> {
  if (nodes.length === 0) return new Map()

  const dirEdges = edges.filter(isDirected)
  const removed  = removeCycleEdges(nodes, dirEdges)

  // Build clean DAG adjacency
  const successors   = new Map<string, string[]>()
  const predecessors = new Map<string, string[]>()
  const dagNodeIds   = new Set<string>()

  for (const n of nodes) { successors.set(n.id, []); predecessors.set(n.id, []) }

  for (const e of dirEdges) {
    if (removed.has(e.id)) continue
    successors.get(e.source)!.push(e.target)
    predecessors.get(e.target)!.push(e.source)
    dagNodeIds.add(e.source)
    dagNodeIds.add(e.target)
  }

  // In-degree within the DAG
  const inDeg = new Map<string, number>()
  for (const n of nodes) inDeg.set(n.id, predecessors.get(n.id)!.length)

  // Roots: nodes that participate in the DAG and have no predecessors
  const queue: string[] = []
  const ranks = new Map<string, number>()

  for (const id of dagNodeIds) {
    if (inDeg.get(id) === 0) {
      queue.push(id)
      ranks.set(id, 0)
    }
  }

  // Fallback: all directed nodes are in cycles → pick highest-degree node as root
  if (queue.length === 0 && dagNodeIds.size > 0) {
    const deg = buildDegreeMap(nodes, edges)
    let root = '', best = -1
    for (const id of dagNodeIds) {
      const d = deg.get(id) ?? 0
      if (d > best) { best = d; root = id }
    }
    queue.push(root)
    ranks.set(root, 0)
    inDeg.set(root, 0)
  }

  // BFS with longest-path rank assignment
  const tempInDeg = new Map(inDeg)
  const bfsQueue  = [...queue]

  while (bfsQueue.length > 0) {
    const curr     = bfsQueue.shift()!
    const currRank = ranks.get(curr) ?? 0

    for (const succ of successors.get(curr) ?? []) {
      const candidate = currRank + 1
      if (!ranks.has(succ) || ranks.get(succ)! < candidate) {
        ranks.set(succ, candidate)
      }
      const newDeg = (tempInDeg.get(succ) ?? 1) - 1
      tempInDeg.set(succ, newDeg)
      if (newDeg === 0) bfsQueue.push(succ)
    }
  }

  // Nodes not in the directed graph: assign based on undirected neighbours
  const allNeighbours = new Map<string, string[]>()
  for (const n of nodes) allNeighbours.set(n.id, [])
  for (const e of edges) {
    allNeighbours.get(e.source)?.push(e.target)
    allNeighbours.get(e.target)?.push(e.source)
  }

  for (const n of nodes) {
    if (ranks.has(n.id)) continue
    const rankedNbrs = (allNeighbours.get(n.id) ?? []).filter(id => ranks.has(id))
    if (rankedNbrs.length > 0) {
      const avg = rankedNbrs.reduce((s, id) => s + ranks.get(id)!, 0) / rankedNbrs.length
      ranks.set(n.id, Math.round(avg))
    } else {
      ranks.set(n.id, 0)
    }
  }

  return ranks
}

// ---------------------------------------------------------------------------
// Phase 2 — Initial Position Assignment
//
// Within each rank row, nodes are sorted by total degree descending
// (hub characters centred) and spaced by COLUMN_SPACING.
// Two passes of barycentric crossing reduction are applied.
// ---------------------------------------------------------------------------

/**
 * Crossing minimisation — Sugiyama-style alternating barycentric sweeps
 * followed by a greedy adjacent-swap pass.
 *
 * Each full round consists of:
 *   1. Forward sweep  (rank 0 → max): fix upper row, reorder lower by barycenter.
 *   2. Backward sweep (rank max → 0): fix lower row, reorder upper by barycenter.
 *   3. Greedy adjacent-swap pass: for each row try all neighbouring swaps; keep
 *      the swap when it strictly reduces the cross-count with both adjacent rows.
 *
 * 5 rounds is enough to near-converge on graphs up to ~80 nodes.
 */
function minimizeCrossings(
  byRank: Map<number, string[]>,
  edges: readonly Edge[],
  rounds: number = 5,
): Map<number, string[]> {
  const result = new Map(Array.from(byRank, ([k, v]) => [k, [...v]]))
  const sortedRanks = [...result.keys()].sort((a, b) => a - b)
  if (sortedRanks.length < 2) return result

  // ── Helpers ──────────────────────────────────────────────────────────────

  // Rebuild the node→rank lookup (must refresh after each reorder)
  const buildNodeRank = () => {
    const m = new Map<string, number>()
    for (const [rank, row] of result) for (const id of row) m.set(id, rank)
    return m
  }

  // Barycenter of `id` in its current row, computed from neighbour positions
  // in adjacent rows (skip same-rank neighbours — they don't generate crossings).
  const barycenter = (id: string, rank: number, nodeRank: Map<string, number>): number => {
    const nbrPositions: number[] = []
    for (const e of edges) {
      let nbrId: string | undefined
      if (e.source === id) nbrId = e.target
      else if (e.target === id) nbrId = e.source
      if (!nbrId) continue
      const nbrRank = nodeRank.get(nbrId)
      if (nbrRank === undefined || nbrRank === rank) continue
      const nbrRow = result.get(nbrRank)
      if (!nbrRow) continue
      const idx = nbrRow.indexOf(nbrId)
      if (idx !== -1) nbrPositions.push(idx)
    }
    const row = result.get(rank)!
    return nbrPositions.length > 0
      ? nbrPositions.reduce((a, b) => a + b, 0) / nbrPositions.length
      : row.indexOf(id)
  }

  // Count edge crossings between `row` (at `rank`) and an adjacent row.
  // Two edges (a1→b1) and (a2→b2) cross iff their rank-r endpoints are in a
  // different relative order to their rank-(r±1) endpoints.
  const crossingsWithRow = (
    row: string[],
    rank: number,
    otherRank: number,
    nodeRank: Map<string, number>,
  ): number => {
    const otherRow = result.get(otherRank)
    if (!otherRow) return 0

    const posHere  = new Map(row.map((id, i) => [id, i]))
    const posOther = new Map(otherRow.map((id, i) => [id, i]))

    // Collect inter-row edge endpoint pairs [pos-in-row, pos-in-other-row]
    const pairs: [number, number][] = []
    for (const e of edges) {
      const srcHere  = posHere.get(e.source)
      const tgtOther = posOther.get(e.target)
      if (srcHere !== undefined && tgtOther !== undefined) {
        pairs.push([srcHere, tgtOther])
        continue
      }
      const tgtHere  = posHere.get(e.target)
      const srcOther = posOther.get(e.source)
      if (tgtHere !== undefined && srcOther !== undefined) {
        pairs.push([tgtHere, srcOther])
      }
    }

    // Count inversions (O(n²) — fine for small graphs)
    let count = 0
    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) {
        const [a1, b1] = pairs[i]!
        const [a2, b2] = pairs[j]!
        if ((a1 < a2 && b1 > b2) || (a1 > a2 && b1 < b2)) count++
      }
    }
    return count
  }

  // Reorder a single row by barycenter values.
  const sweepRow = (rank: number, nodeRank: Map<string, number>) => {
    const row = result.get(rank)!
    const bary = new Map(row.map(id => [id, barycenter(id, rank, nodeRank)]))
    result.set(rank, [...row].sort((a, b) => (bary.get(a) ?? 0) - (bary.get(b) ?? 0)))
  }

  // ── Main loop ─────────────────────────────────────────────────────────────

  for (let round = 0; round < rounds; round++) {
    let nodeRank = buildNodeRank()

    // Forward sweep: reorder lower rows based on fixed upper rows
    for (const rank of sortedRanks) {
      sweepRow(rank, nodeRank)
      nodeRank = buildNodeRank()
    }

    // Backward sweep: reorder upper rows based on fixed lower rows
    for (const rank of [...sortedRanks].reverse()) {
      sweepRow(rank, nodeRank)
      nodeRank = buildNodeRank()
    }

    // Greedy adjacent-swap pass
    nodeRank = buildNodeRank()
    for (const rank of sortedRanks) {
      const row = result.get(rank)!
      const prevRank = sortedRanks.find(r => r < rank && result.has(r))
      const nextRank = sortedRanks.find(r => r > rank && result.has(r))

      const crossCount = () =>
        (prevRank !== undefined ? crossingsWithRow(row, rank, prevRank, nodeRank) : 0) +
        (nextRank !== undefined ? crossingsWithRow(row, rank, nextRank, nodeRank) : 0)

      let improved = true
      while (improved) {
        improved = false
        for (let i = 0; i < row.length - 1; i++) {
          const before = crossCount()
          // Swap adjacent pair
          ;[row[i], row[i + 1]] = [row[i + 1]!, row[i]!]
          if (crossCount() < before) {
            improved = true // keep swap
          } else {
            // Revert
            ;[row[i], row[i + 1]] = [row[i + 1]!, row[i]!]
          }
        }
      }
      result.set(rank, row)
      nodeRank = buildNodeRank()
    }
  }

  return result
}

/**
 * Phase 2: compute initial (x, y) positions from rank assignments.
 * Exported for unit testing.
 */
export function initialLayout(
  nodes: readonly Node[],
  edges: readonly Edge[],
  ranks: Map<string, number>,
): Map<string, Vec2> {
  const { MIN_NODE_DIST, RANK_HEIGHT } = LAYOUT_CONSTANTS
  const deg = buildDegreeMap(nodes, edges)

  // Group by rank
  const byRankRaw = new Map<number, string[]>()
  for (const n of nodes) {
    const r = ranks.get(n.id) ?? 0
    if (!byRankRaw.has(r)) byRankRaw.set(r, [])
    byRankRaw.get(r)!.push(n.id)
  }

  // Sort each row by degree descending, then reorder centre-out so the
  // highest-degree node lands at x ≈ 0 and lower-degree nodes radiate outward.
  for (const [r, row] of byRankRaw) {
    const byDeg = [...row].sort((a, b) => (deg.get(b) ?? 0) - (deg.get(a) ?? 0))
    byRankRaw.set(r, centerOut(byDeg))
  }

  // Crossing minimisation (alternating sweeps + greedy swaps)
  const byRank = minimizeCrossings(byRankRaw, edges)

  // Assign positions
  const positions = new Map<string, Vec2>()

  for (const [rank, row] of byRank) {
    const avgDeg = row.reduce((s, id) => s + (deg.get(id) ?? 0), 0) / Math.max(row.length, 1)
    const colSpacing = Math.max(MIN_NODE_DIST, avgDeg * 20)

    for (let i = 0; i < row.length; i++) {
      const id = row[i]!
      positions.set(id, {
        x: (i - (row.length - 1) / 2) * colSpacing,
        y: rank * RANK_HEIGHT,
      })
    }
  }

  return positions
}

// ---------------------------------------------------------------------------
// Phase 3 — Force-Directed Refinement
//
// Four forces per iteration:
//   1. Repulsion  — all pairs, Coulomb 1/r²
//   2. Attraction — edge pairs only, Hooke (directed edges weighted ×1.5)
//   3. Rank anchoring — weak y-pull toward rank * RANK_HEIGHT
//   4. Centre gravity — weak pull toward (0,0) to prevent cluster drift
//
// Euler integration with velocity damping. Stops at MAX_ITERATIONS or
// when max velocity drops below CONVERGENCE_THRESHOLD.
// ---------------------------------------------------------------------------

/**
 * Phase 3: refine positions with force-directed simulation.
 * Exported for unit testing.
 * @param frozenIds  Node IDs whose positions must not change (Phase 4 use).
 */
export function refineLayout(
  positions: Map<string, Vec2>,
  nodes: readonly Node[],
  edges: readonly Edge[],
  ranks: Map<string, number>,
  frozenIds: ReadonlySet<string> = new Set(),
): Map<string, Vec2> {
  const {
    MIN_NODE_DIST, TARGET_EDGE_LENGTH, RANK_HEIGHT,
    REPULSION_STRENGTH, SPRING_K, ANCHOR_K, GRAVITY_K,
    DAMPING, MAX_STEP, MAX_ITERATIONS, CONVERGENCE_THRESHOLD,
    MIN_NODE_EDGE_DIST, NODE_EDGE_REPULSION,
  } = LAYOUT_CONSTANTS

  // Deep-copy positions so we don't mutate the input
  const pos = new Map(Array.from(positions, ([k, v]) => [k, { x: v.x, y: v.y }]))
  const vel = new Map(nodes.map(n => [n.id, { x: 0, y: 0 }]))
  const ids = nodes.map(n => n.id).filter(id => !frozenIds.has(id))

  // Pre-jitter: add a tiny index-dependent offset so no two mutable nodes
  // start at exactly the same position (prevents undefined force direction).
  for (let i = 0; i < ids.length; i++) {
    const angle = (i * 2 * Math.PI) / Math.max(ids.length, 1)
    const p = pos.get(ids[i]!)!
    p.x += Math.cos(angle) * 0.5 * (i + 1)
    p.y += Math.sin(angle) * 0.5 * (i + 1)
  }

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const forces = new Map(ids.map(id => [id, { x: 0, y: 0 }]))

    // ── 1. Repulsion (all pairs including frozen nodes as repellers) ──────
    const allIds = [...pos.keys()]
    for (let i = 0; i < ids.length; i++) {
      const a  = ids[i]!
      const pa = pos.get(a)!
      for (let j = 0; j < allIds.length; j++) {
        const b = allIds[j]!
        if (b === a) continue
        const pb  = pos.get(b)!
        const dx  = pa.x - pb.x
        const dy  = pa.y - pb.y
        const d2  = dx * dx + dy * dy || 0.0001
        const d   = Math.sqrt(d2)
        const mag = d < MIN_NODE_DIST / 2
          ? REPULSION_STRENGTH * 10 / d2
          : REPULSION_STRENGTH / d2
        forces.get(a)!.x += (dx / d) * mag
        forces.get(a)!.y += (dy / d) * mag
      }
    }

    // ── 2. Attraction (edges only) ────────────────────────────────────────
    for (const e of edges) {
      const pa = pos.get(e.source)
      const pb = pos.get(e.target)
      if (!pa || !pb) continue
      const isA = !frozenIds.has(e.source)
      const isB = !frozenIds.has(e.target)
      if (!isA && !isB) continue

      const k   = isDirected(e) ? SPRING_K * 1.5 : SPRING_K
      const dx  = pb.x - pa.x
      const dy  = pb.y - pa.y
      const d   = Math.sqrt(dx * dx + dy * dy) || 0.0001
      const mag = k * (d - TARGET_EDGE_LENGTH)
      const fx  = (dx / d) * mag
      const fy  = (dy / d) * mag

      if (isA) { forces.get(e.source)!.x += fx; forces.get(e.source)!.y += fy }
      if (isB) { forces.get(e.target)!.x -= fx; forces.get(e.target)!.y -= fy }
    }

    // ── 3. Rank anchoring (y-axis only) ──────────────────────────────────
    for (const id of ids) {
      const targetY = (ranks.get(id) ?? 0) * RANK_HEIGHT
      forces.get(id)!.y += ANCHOR_K * (targetY - pos.get(id)!.y)
    }

    // ── 4. Centre gravity ────────────────────────────────────────────────
    for (const id of ids) {
      const p = pos.get(id)!
      forces.get(id)!.x += GRAVITY_K * -p.x
      forces.get(id)!.y += GRAVITY_K * -p.y
    }

    // ── 5. Node-edge repulsion ────────────────────────────────────────────
    // For each movable node, push it away from any non-adjacent edge whose
    // closest point is within MIN_NODE_EDGE_DIST.  Edge positions are
    // approximated as the straight segment between current node centres.
    for (const n of ids) {
      const pn = pos.get(n)!
      for (const e of edges) {
        if (e.source === n || e.target === n) continue          // adjacent — skip
        const ps = pos.get(e.source)
        const pt = pos.get(e.target)
        if (!ps || !pt) continue

        const [cx, cy] = closestPointOnSegment(ps.x, ps.y, pt.x, pt.y, pn.x, pn.y)
        const dnx  = pn.x - cx
        const dny  = pn.y - cy
        const dist = Math.sqrt(dnx * dnx + dny * dny)

        if (dist < MIN_NODE_EDGE_DIST && dist > 0.001) {
          const mag = NODE_EDGE_REPULSION * (MIN_NODE_EDGE_DIST - dist) / dist
          forces.get(n)!.x += (dnx / dist) * mag
          forces.get(n)!.y += (dny / dist) * mag
        }
      }
    }

    // ── Integration ───────────────────────────────────────────────────────
    let maxVel = 0
    for (const id of ids) {
      const v = vel.get(id)!
      const f = forces.get(id)!
      v.x = (v.x + f.x) * DAMPING
      v.y = (v.y + f.y) * DAMPING
      // Clamp displacement per step to prevent nodes flying off when forces
      // are large (e.g. many closely-packed nodes at simulation start).
      const speed = Math.sqrt(v.x * v.x + v.y * v.y)
      if (speed > MAX_STEP) {
        const scale = MAX_STEP / speed
        v.x *= scale
        v.y *= scale
      }
      const p = pos.get(id)!
      p.x += v.x
      p.y += v.y
      if (speed > maxVel) maxVel = speed
    }

    if (maxVel < CONVERGENCE_THRESHOLD) break
  }

  // Post-processing: hard separation guarantee.
  // Push apart any remaining pairs closer than MIN_NODE_DIST. This ensures
  // the constraint holds regardless of whether the force simulation converged
  // (degenerate starts — e.g. all nodes at (0,0) — may not fully resolve in
  // MAX_ITERATIONS steps).
  const allIds = [...pos.keys()]
  for (let pass = 0; pass < 30; pass++) {
    let anyViolation = false
    for (const a of ids) {
      const pa = pos.get(a)!
      for (const b of allIds) {
        if (b === a) continue
        const pb = pos.get(b)!
        const dx   = pa.x - pb.x
        const dy   = pa.y - pb.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.001
        if (dist < MIN_NODE_DIST) {
          anyViolation = true
          const overlap  = MIN_NODE_DIST - dist + 1 // 1px safety margin
          const nx = dx / dist
          const ny = dy / dist
          const bFrozen   = frozenIds.has(b)
          const fraction  = bFrozen ? 1.0 : 0.5
          pa.x += nx * overlap * fraction
          pa.y += ny * overlap * fraction
          if (!bFrozen) {
            pb.x -= nx * overlap * 0.5
            pb.y -= ny * overlap * 0.5
          }
        }
      }
    }
    if (!anyViolation) break
  }

  // Post-processing: hard node-edge separation guarantee.
  // Push any non-adjacent node that still sits within MIN_NODE_EDGE_DIST of
  // an edge segment away by exactly the gap required.  The edge segment is
  // recomputed each pass from current node positions.
  for (let pass = 0; pass < 20; pass++) {
    let anyViolation = false
    for (const n of ids) {
      const pn = pos.get(n)!
      for (const e of edges) {
        if (e.source === n || e.target === n) continue
        const ps = pos.get(e.source)
        const pt = pos.get(e.target)
        if (!ps || !pt) continue

        const [cx, cy] = closestPointOnSegment(ps.x, ps.y, pt.x, pt.y, pn.x, pn.y)
        const dnx  = pn.x - cx
        const dny  = pn.y - cy
        const dist = Math.sqrt(dnx * dnx + dny * dny)

        if (dist < MIN_NODE_EDGE_DIST) {
          anyViolation = true
          const push = MIN_NODE_EDGE_DIST - dist + 1
          // If the node is exactly on the segment, push perpendicularly to
          // the edge direction to avoid a zero-direction push.
          if (dist < 0.001) {
            const edx = pt.x - ps.x
            const edy = pt.y - ps.y
            const el  = Math.sqrt(edx * edx + edy * edy) || 1
            pn.x += (-edy / el) * push
            pn.y += ( edx / el) * push
          } else {
            pn.x += (dnx / dist) * push
            pn.y += (dny / dist) * push
          }
        }
      }
    }
    if (!anyViolation) break
  }

  return pos
}

// ---------------------------------------------------------------------------
// Phase 4 — Incremental New Node Placement
//
// Called when existing nodes have saved positions and only a few new nodes
// have appeared (e.g. a new character in the next chapter). Existing nodes
// are never moved; new nodes are placed near their neighbours and then
// refined with 20 force iterations (existing nodes frozen as anchors).
// ---------------------------------------------------------------------------

/**
 * Phase 4: place new nodes without disturbing existing positions.
 * Exported for unit testing.
 */
export function placeNewNodes(
  newNodeIds: readonly string[],
  existingPositions: Map<string, Vec2>,
  allNodes: readonly Node[],
  edges: readonly Edge[],
): Map<string, Vec2> {
  const { MIN_NODE_DIST, TARGET_EDGE_LENGTH } = LAYOUT_CONSTANTS

  const positions = new Map(Array.from(existingPositions, ([k, v]) => [k, { x: v.x, y: v.y }]))

  // Build neighbour list (all edges)
  const neighbours = new Map<string, string[]>()
  for (const n of allNodes) neighbours.set(n.id, [])
  for (const e of edges) {
    neighbours.get(e.source)?.push(e.target)
    neighbours.get(e.target)?.push(e.source)
  }

  // 8 evenly-spaced cardinal + diagonal directions
  const DIRECTIONS: Vec2[] = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI * 2) / 8
    return { x: Math.cos(a), y: Math.sin(a) }
  })

  for (const id of newNodeIds) {
    const positioned = (neighbours.get(id) ?? []).filter(nid => positions.has(nid))

    let candidate: Vec2

    if (positioned.length > 0) {
      // Seed at the centroid of existing neighbours
      const seed: Vec2 = {
        x: positioned.reduce((s, nid) => s + positions.get(nid)!.x, 0) / positioned.length,
        y: positioned.reduce((s, nid) => s + positions.get(nid)!.y, 0) / positioned.length,
      }

      // Pick direction with fewest nodes within a 90° cone
      let bestDir  = DIRECTIONS[0]!
      let bestScore = Infinity

      for (const dir of DIRECTIONS) {
        let score = 0
        for (const [, p] of positions) {
          const dx   = p.x - seed.x
          const dy   = p.y - seed.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist > MIN_NODE_DIST * 2) continue
          if (dx * dir.x + dy * dir.y > 0) score++
        }
        if (score < bestScore) { bestScore = score; bestDir = dir }
      }

      candidate = {
        x: seed.x + bestDir.x * TARGET_EDGE_LENGTH,
        y: seed.y + bestDir.y * TARGET_EDGE_LENGTH,
      }

      // Nudge until clear of all existing nodes.
      // Move by exactly the gap needed (+ 1px margin) in the chosen direction.
      for (let attempt = 0; attempt < 50; attempt++) {
        let tooClose = false
        for (const [, p] of positions) {
          const dx   = candidate.x - p.x
          const dy   = candidate.y - p.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < MIN_NODE_DIST) {
            const push = MIN_NODE_DIST - dist + 1
            candidate.x += bestDir.x * push
            candidate.y += bestDir.y * push
            tooClose = true
            break
          }
        }
        if (!tooClose) break
      }
    } else {
      // No positioned neighbours — find the least-dense cell in a 4×4 grid
      const pts = [...positions.values()]

      if (pts.length === 0) {
        candidate = { x: 0, y: 0 }
      } else {
        const xs   = pts.map(p => p.x)
        const ys   = pts.map(p => p.y)
        const minX = Math.min(...xs) - MIN_NODE_DIST
        const maxX = Math.max(...xs) + MIN_NODE_DIST
        const minY = Math.min(...ys) - MIN_NODE_DIST
        const maxY = Math.max(...ys) + MIN_NODE_DIST
        const GRID = 4

        let bestCell: Vec2 = { x: 0, y: 0 }
        let bestCount = Infinity

        for (let row = 0; row < GRID; row++) {
          for (let col = 0; col < GRID; col++) {
            const cx = minX + (col + 0.5) * (maxX - minX) / GRID
            const cy = minY + (row + 0.5) * (maxY - minY) / GRID
            let count = 0
            for (const p of pts) {
              const dx = cx - p.x
              const dy = cy - p.y
              if (Math.sqrt(dx * dx + dy * dy) < MIN_NODE_DIST * 2) count++
            }
            if (count < bestCount) { bestCount = count; bestCell = { x: cx, y: cy } }
          }
        }
        candidate = bestCell
      }
    }

    positions.set(id, candidate)
  }

  // 20 force refinement iterations with all pre-existing nodes frozen
  const frozenIds = new Set(existingPositions.keys())

  // We need a rank map; for incremental placement approximate all new nodes at rank 0
  const tempRanks = new Map<string, number>()
  for (const n of allNodes) tempRanks.set(n.id, 0)

  return refineLayout(positions, allNodes, edges, tempRanks, frozenIds)
}

// ---------------------------------------------------------------------------
// Top-level entry point — replaces applyDagreLayout in GraphCanvas
// ---------------------------------------------------------------------------

/**
 * Full layout pipeline (Phases 1–3) followed by a saved-position override.
 * If `savedPositions` is provided and covers some nodes, new nodes are placed
 * incrementally (Phase 4) instead of re-running the full pipeline.
 */
export function applyLayout(
  nodes: readonly Node[],
  edges: readonly Edge[],
  savedPositions?: Map<string, Vec2>,
): Node[] {
  if (nodes.length === 0) return []

  const saved     = savedPositions ?? new Map<string, Vec2>()
  const newIds    = nodes.map(n => n.id).filter(id => !saved.has(id))
  const hasExisting = nodes.some(n => saved.has(n.id))

  let positions: Map<string, Vec2>

  if (hasExisting && newIds.length < nodes.length) {
    // Incremental: only place new nodes; existing positions unchanged
    const existingPositions = new Map(
      nodes.filter(n => saved.has(n.id)).map(n => [n.id, saved.get(n.id)!]),
    )
    positions = placeNewNodes(newIds, existingPositions, nodes, edges)
  } else {
    // Full layout: Phase 1 → 2 → 3
    const ranks  = assignRanks(nodes, edges)
    const init   = initialLayout(nodes, edges, ranks)
    positions    = refineLayout(init, nodes, edges, ranks)

    // Apply any saved positions on top (user-dragged overrides)
    for (const [id, p] of saved) {
      if (positions.has(id)) positions.set(id, p)
    }
  }

  return nodes.map(n => ({
    ...n,
    position: positions.get(n.id) ?? { x: 0, y: 0 },
  }))
}

// ---------------------------------------------------------------------------
// Legacy — kept until GraphCanvas is updated and tests are migrated
// ---------------------------------------------------------------------------

/**
 * Apply a Dagre hierarchical layout.
 * @deprecated Use applyLayout instead.
 */
export const applyDagreLayout = (
  nodes: readonly Node[],
  edges: readonly Edge[],
): Node[] => {
  if (nodes.length === 0) return []

  const g = new Dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 120, marginx: 60, marginy: 60 })

  for (const node of nodes) g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })

  for (const edge of edges) {
    if (isDirected(edge)) {
      g.setEdge(edge.source, edge.target, { minlen: 1, weight: 2 })
    } else {
      g.setEdge(edge.source, edge.target, { minlen: 1, weight: 1 })
      g.setEdge(edge.target, edge.source, { minlen: 1, weight: 1 })
    }
  }

  Dagre.layout(g)

  return nodes.map(node => {
    const { x, y } = g.node(node.id)
    return { ...node, position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 } }
  })
}
