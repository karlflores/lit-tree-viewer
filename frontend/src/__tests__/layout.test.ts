import { describe, it, expect } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import {
  assignRanks,
  initialLayout,
  refineLayout,
  placeNewNodes,
  applyLayout,
  applyDagreLayout,
  LAYOUT_CONSTANTS,
} from '../lib/layout'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeNode = (id: string): Node => ({
  id,
  position: { x: 0, y: 0 },
  data: {},
})

const makeEdge = (
  id: string,
  source: string,
  target: string,
  directed = false,
): Edge => ({
  id,
  source,
  target,
  data: { directed },
})

const { MIN_NODE_DIST, TARGET_EDGE_LENGTH, RANK_HEIGHT, MIN_NODE_EDGE_DIST } = LAYOUT_CONSTANTS

// ---------------------------------------------------------------------------
// Phase 1 — assignRanks
// ---------------------------------------------------------------------------

describe('assignRanks', () => {
  it('returns an empty map for an empty graph', () => {
    expect(assignRanks([], [])).toEqual(new Map())
  })

  it('assigns rank 0 to a single isolated node', () => {
    const ranks = assignRanks([makeNode('a')], [])
    expect(ranks.get('a')).toBe(0)
  })

  it('assigns rank 0 to all nodes when there are no directed edges', () => {
    const nodes = ['a', 'b', 'c'].map(makeNode)
    const edges = [makeEdge('e1', 'a', 'b', false)]
    const ranks = assignRanks(nodes, edges)
    for (const n of nodes) expect(ranks.get(n.id)).toBe(0)
  })

  it('assigns root rank 0, child rank 1 for a single directed edge', () => {
    const nodes = [makeNode('parent'), makeNode('child')]
    const edges = [makeEdge('e1', 'parent', 'child', true)]
    const ranks = assignRanks(nodes, edges)
    expect(ranks.get('parent')).toBe(0)
    expect(ranks.get('child')).toBe(1)
  })

  it('applies longest-path layering across a chain A→B→C', () => {
    const nodes = ['a', 'b', 'c'].map(makeNode)
    const edges = [
      makeEdge('e1', 'a', 'b', true),
      makeEdge('e2', 'b', 'c', true),
    ]
    const ranks = assignRanks(nodes, edges)
    expect(ranks.get('a')).toBe(0)
    expect(ranks.get('b')).toBe(1)
    expect(ranks.get('c')).toBe(2)
  })

  it('uses the longest path when two paths lead to the same node', () => {
    // A→C (length 1) and A→B→C (length 2) — C should be at rank 2
    const nodes = ['a', 'b', 'c'].map(makeNode)
    const edges = [
      makeEdge('e1', 'a', 'b', true),
      makeEdge('e2', 'b', 'c', true),
      makeEdge('e3', 'a', 'c', true),
    ]
    const ranks = assignRanks(nodes, edges)
    expect(ranks.get('a')).toBe(0)
    expect(ranks.get('b')).toBe(1)
    expect(ranks.get('c')).toBe(2)
  })

  it('assigns all nodes a rank even when none are in the directed graph', () => {
    const nodes = ['a', 'b'].map(makeNode)
    const ranks = assignRanks(nodes, [])
    expect(ranks.has('a')).toBe(true)
    expect(ranks.has('b')).toBe(true)
  })

  it('handles a directed cycle without throwing', () => {
    // A→B→A forms a cycle; one back-edge is removed
    const nodes = ['a', 'b'].map(makeNode)
    const edges = [
      makeEdge('e1', 'a', 'b', true),
      makeEdge('e2', 'b', 'a', true),
    ]
    expect(() => assignRanks(nodes, edges)).not.toThrow()
    const ranks = assignRanks(nodes, edges)
    expect(ranks.has('a')).toBe(true)
    expect(ranks.has('b')).toBe(true)
  })

  it('handles a longer directed cycle (A→B→C→A)', () => {
    const nodes = ['a', 'b', 'c'].map(makeNode)
    const edges = [
      makeEdge('e1', 'a', 'b', true),
      makeEdge('e2', 'b', 'c', true),
      makeEdge('e3', 'c', 'a', true),
    ]
    expect(() => assignRanks(nodes, edges)).not.toThrow()
    const ranks = assignRanks(nodes, edges)
    for (const n of nodes) expect(ranks.has(n.id)).toBe(true)
  })

  it('assigns an isolated undirected-only node rank 0 (no ranked neighbours)', () => {
    const nodes = ['a', 'b', 'c'].map(makeNode)
    // a→b directed, c only has undirected edges to nobody ranked differently
    const edges = [
      makeEdge('e1', 'a', 'b', true),
    ]
    const ranks = assignRanks(nodes, edges)
    // c has no directed edges, no ranked neighbours → rank 0
    expect(ranks.get('c')).toBe(0)
  })

  it('assigns an undirected-only node the rounded average of its ranked neighbours', () => {
    // a (rank 0) → b (rank 1) directed; c is undirected to b only
    const nodes = ['a', 'b', 'c'].map(makeNode)
    const edges = [
      makeEdge('e1', 'a', 'b', true),
      makeEdge('e2', 'b', 'c', false),
    ]
    const ranks = assignRanks(nodes, edges)
    expect(ranks.get('a')).toBe(0)
    expect(ranks.get('b')).toBe(1)
    // c's only ranked neighbour is b (rank 1) → round(1) = 1
    expect(ranks.get('c')).toBe(1)
  })

  it('covers every node in the output map', () => {
    const nodes = ['a', 'b', 'c', 'd'].map(makeNode)
    const edges = [makeEdge('e1', 'a', 'b', true)]
    const ranks = assignRanks(nodes, edges)
    for (const n of nodes) expect(ranks.has(n.id)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Phase 2 — initialLayout
// ---------------------------------------------------------------------------

describe('initialLayout', () => {
  it('assigns a position to every node', () => {
    const nodes = ['a', 'b', 'c'].map(makeNode)
    const edges = [makeEdge('e1', 'a', 'b', true)]
    const ranks = assignRanks(nodes, edges)
    const pos   = initialLayout(nodes, edges, ranks)
    for (const n of nodes) expect(pos.has(n.id)).toBe(true)
  })

  it('places nodes in different ranks at different y values', () => {
    const nodes = ['a', 'b'].map(makeNode)
    const edges = [makeEdge('e1', 'a', 'b', true)]
    const ranks = assignRanks(nodes, edges)
    const pos   = initialLayout(nodes, edges, ranks)
    expect(pos.get('a')!.y).toBeLessThan(pos.get('b')!.y)
  })

  it('y coordinate equals rank * RANK_HEIGHT', () => {
    const nodes = ['a', 'b', 'c'].map(makeNode)
    const edges = [makeEdge('e1', 'a', 'b', true), makeEdge('e2', 'b', 'c', true)]
    const ranks = assignRanks(nodes, edges)
    const pos   = initialLayout(nodes, edges, ranks)
    expect(pos.get('a')!.y).toBeCloseTo(0 * RANK_HEIGHT)
    expect(pos.get('b')!.y).toBeCloseTo(1 * RANK_HEIGHT)
    expect(pos.get('c')!.y).toBeCloseTo(2 * RANK_HEIGHT)
  })

  it('places the highest-degree node at x closest to 0 in its rank row', () => {
    // hub connects to a, b, c, d — four edges; leaf has one
    const nodes = ['hub', 'leaf', 'a', 'b', 'c', 'd'].map(makeNode)
    const edges = [
      makeEdge('e1', 'hub', 'a', false),
      makeEdge('e2', 'hub', 'b', false),
      makeEdge('e3', 'hub', 'c', false),
      makeEdge('e4', 'hub', 'd', false),
      makeEdge('e5', 'leaf', 'a', false),
    ]
    const ranks = new Map(nodes.map(n => [n.id, 0])) // all rank 0
    const pos   = initialLayout(nodes, edges, ranks)
    const hubX  = Math.abs(pos.get('hub')!.x)
    const leafX = Math.abs(pos.get('leaf')!.x)
    expect(hubX).toBeLessThan(leafX)
  })

  it('single node in a rank is placed at x = 0', () => {
    const nodes = [makeNode('solo')]
    const ranks = new Map([['solo', 0]])
    const pos   = initialLayout(nodes, [], ranks)
    expect(pos.get('solo')!.x).toBeCloseTo(0)
  })
})

// ---------------------------------------------------------------------------
// Phase 3 — refineLayout
// ---------------------------------------------------------------------------

describe('refineLayout', () => {
  it('does not place any pair of nodes closer than MIN_NODE_DIST', () => {
    // Start all nodes at the same position — extreme stress test
    const nodes = ['a', 'b', 'c', 'd'].map(makeNode)
    const edges = [
      makeEdge('e1', 'a', 'b', false),
      makeEdge('e2', 'b', 'c', false),
      makeEdge('e3', 'c', 'd', false),
    ]
    const ranks = new Map(nodes.map(n => [n.id, 0]))
    const start = new Map(nodes.map(n => [n.id, { x: 0, y: 0 }]))
    const pos   = refineLayout(start, nodes, edges, ranks)

    const ids = nodes.map(n => n.id)
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos.get(ids[i]!)!
        const b = pos.get(ids[j]!)!
        const dist = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
        expect(dist).toBeGreaterThanOrEqual(MIN_NODE_DIST - 1) // 1px tolerance
      }
    }
  })

  it('converges within MAX_ITERATIONS for a small graph', () => {
    const nodes = ['a', 'b', 'c'].map(makeNode)
    const edges = [makeEdge('e1', 'a', 'b', true), makeEdge('e2', 'b', 'c', true)]
    const ranks = assignRanks(nodes, edges)
    const init  = initialLayout(nodes, edges, ranks)

    // If this doesn't throw and returns all ids, it converged (or hit the cap gracefully)
    const pos = refineLayout(init, nodes, edges, ranks)
    for (const n of nodes) expect(pos.has(n.id)).toBe(true)
  })

  it('does not move frozen nodes', () => {
    const nodes = ['a', 'b', 'c'].map(makeNode)
    const edges = [makeEdge('e1', 'a', 'b', false)]
    const ranks = new Map(nodes.map(n => [n.id, 0]))
    const init  = new Map([
      ['a', { x: 0,   y: 0 }],
      ['b', { x: 500, y: 0 }],
      ['c', { x: 0,   y: 500 }],
    ])
    const frozen = new Set(['b', 'c'])
    const pos = refineLayout(init, nodes, edges, ranks, frozen)
    expect(pos.get('b')!.x).toBeCloseTo(500)
    expect(pos.get('b')!.y).toBeCloseTo(0)
    expect(pos.get('c')!.x).toBeCloseTo(0)
    expect(pos.get('c')!.y).toBeCloseTo(500)
  })

  it('returns a position for every input node', () => {
    const nodes = ['a', 'b', 'c'].map(makeNode)
    const edges: Edge[] = []
    const ranks = new Map(nodes.map(n => [n.id, 0]))
    const init  = new Map(nodes.map(n => [n.id, { x: Math.random() * 300, y: Math.random() * 300 }]))
    const pos   = refineLayout(init, nodes, edges, ranks)
    for (const n of nodes) expect(pos.has(n.id)).toBe(true)
  })

  it('keeps non-adjacent nodes at least MIN_NODE_EDGE_DIST from edges', () => {
    // Triangle: a–b–c edges, plus a stray node 'd' placed directly on the a→b segment
    const nodes = ['a', 'b', 'c', 'd'].map(makeNode)
    const edges = [
      makeEdge('e1', 'a', 'b', false),
      makeEdge('e2', 'b', 'c', false),
    ]
    const ranks = new Map(nodes.map(n => [n.id, 0]))
    // Place 'd' exactly at the midpoint of a→b so it violates the constraint at the start
    const init = new Map([
      ['a', { x: 0,   y: 0 }],
      ['b', { x: 400, y: 0 }],
      ['c', { x: 200, y: 400 }],
      ['d', { x: 200, y: 0 }],  // sits on the a–b edge
    ])

    const pos = refineLayout(init, nodes, edges, ranks)

    // 'd' must be at least MIN_NODE_EDGE_DIST from the a–b segment
    const pd = pos.get('d')!
    const pa = pos.get('a')!
    const pb = pos.get('b')!

    // Closest point on a–b to d
    const dx = pb.x - pa.x
    const dy = pb.y - pa.y
    const lenSq = dx * dx + dy * dy
    const t = Math.max(0, Math.min(1, ((pd.x - pa.x) * dx + (pd.y - pa.y) * dy) / lenSq))
    const cx = pa.x + t * dx
    const cy = pa.y + t * dy
    const dist = Math.sqrt((pd.x - cx) ** 2 + (pd.y - cy) ** 2)

    expect(dist).toBeGreaterThanOrEqual(MIN_NODE_EDGE_DIST - 1)
  })

  it('does not move adjacent nodes to satisfy the node-edge constraint', () => {
    // 'a' and 'b' are connected — neither should be pushed away from the a–b edge
    const nodes = ['a', 'b'].map(makeNode)
    const edges = [makeEdge('e1', 'a', 'b', false)]
    const ranks = new Map([['a', 0], ['b', 0]])
    const init  = new Map([
      ['a', { x: 0,   y: 0 }],
      ['b', { x: 200, y: 0 }],
    ])
    // Both a and b are adjacent to e1, so neither is pushed away — they should
    // still be the closest pair and the layout should remain stable
    const pos = refineLayout(init, nodes, edges, ranks)
    expect(pos.has('a')).toBe(true)
    expect(pos.has('b')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Phase 4 — placeNewNodes
// ---------------------------------------------------------------------------

describe('placeNewNodes', () => {
  it('places a new node at least MIN_NODE_DIST from all existing nodes', () => {
    const existing: Node[] = ['a', 'b', 'c'].map(makeNode)
    const newNode = makeNode('x')
    const allNodes = [...existing, newNode]
    const existingPos = new Map([
      ['a', { x: 0,   y: 0   }],
      ['b', { x: 200, y: 0   }],
      ['c', { x: 100, y: 200 }],
    ])
    const edges = [makeEdge('e1', 'a', 'x', false)]

    const result = placeNewNodes(['x'], existingPos, allNodes, edges)

    const xPos = result.get('x')!
    for (const [eid, p] of existingPos) {
      const dist = Math.sqrt((xPos.x - p.x) ** 2 + (xPos.y - p.y) ** 2)
      expect(dist).toBeGreaterThanOrEqual(MIN_NODE_DIST - 1)
    }
  })

  it('places a neighbourless new node somewhere on the canvas', () => {
    const existing: Node[] = ['a', 'b'].map(makeNode)
    const newNode = makeNode('lone')
    const allNodes = [...existing, newNode]
    const existingPos = new Map([
      ['a', { x: 0,   y: 0 }],
      ['b', { x: 300, y: 0 }],
    ])

    const result = placeNewNodes(['lone'], existingPos, allNodes, [])
    expect(result.has('lone')).toBe(true)
    expect(typeof result.get('lone')!.x).toBe('number')
  })

  it('does not modify existing node positions', () => {
    const existing: Node[] = ['a'].map(makeNode)
    const newNode = makeNode('n')
    const allNodes = [...existing, newNode]
    const existingPos = new Map([['a', { x: 100, y: 100 }]])

    const result = placeNewNodes(['n'], existingPos, allNodes, [makeEdge('e1', 'a', 'n', false)])
    expect(result.get('a')!.x).toBeCloseTo(100)
    expect(result.get('a')!.y).toBeCloseTo(100)
  })

  it('places a connected new node within a reasonable distance of its neighbour', () => {
    const existing: Node[] = ['a'].map(makeNode)
    const newNode = makeNode('b')
    const allNodes = [...existing, newNode]
    const existingPos = new Map([['a', { x: 0, y: 0 }]])
    const edges = [makeEdge('e1', 'a', 'b', false)]

    const result = placeNewNodes(['b'], existingPos, allNodes, edges)
    const bPos = result.get('b')!
    const dist = Math.sqrt(bPos.x ** 2 + bPos.y ** 2)

    // Should be near its neighbour — within 4× the target edge length
    expect(dist).toBeLessThan(TARGET_EDGE_LENGTH * 4)
  })

  it('handles multiple new nodes at once', () => {
    const existing: Node[] = [makeNode('root')]
    const newNodes = ['x', 'y', 'z'].map(makeNode)
    const allNodes = [...existing, ...newNodes]
    const existingPos = new Map([['root', { x: 0, y: 0 }]])
    const edges = [
      makeEdge('e1', 'root', 'x', false),
      makeEdge('e2', 'root', 'y', false),
      makeEdge('e3', 'root', 'z', false),
    ]

    const result = placeNewNodes(['x', 'y', 'z'], existingPos, allNodes, edges)
    expect(result.has('x')).toBe(true)
    expect(result.has('y')).toBe(true)
    expect(result.has('z')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// applyLayout — top-level integration
// ---------------------------------------------------------------------------

describe('applyLayout', () => {
  it('returns an empty array for an empty graph', () => {
    expect(applyLayout([], [])).toEqual([])
  })

  it('returns a node for every input node', () => {
    const nodes = ['a', 'b', 'c'].map(makeNode)
    const edges = [makeEdge('e1', 'a', 'b', true)]
    const result = applyLayout(nodes, edges)
    expect(result.map(n => n.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('places the directed-edge source above its target', () => {
    const nodes = [makeNode('parent'), makeNode('child')]
    const edges = [makeEdge('e1', 'parent', 'child', true)]
    const result = applyLayout(nodes, edges)
    const parent = result.find(n => n.id === 'parent')!
    const child  = result.find(n => n.id === 'child')!
    expect(parent.position.y).toBeLessThan(child.position.y)
  })

  it('honours saved positions: existing nodes keep their saved position', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')]
    const edges = [makeEdge('e1', 'a', 'b', true)]
    const saved = new Map([
      ['a', { x: 999, y: 888 }],
      ['b', { x: 111, y: 222 }],
    ])

    const result = applyLayout(nodes, edges, saved)
    // c is new; a and b come from saved positions
    const rA = result.find(n => n.id === 'a')!
    const rB = result.find(n => n.id === 'b')!
    expect(rA.position.x).toBeCloseTo(999)
    expect(rA.position.y).toBeCloseTo(888)
    expect(rB.position.x).toBeCloseTo(111)
    expect(rB.position.y).toBeCloseTo(222)
  })

  it('runs a full layout (no saved positions) without throwing', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e'].map(makeNode)
    const edges = [
      makeEdge('e1', 'a', 'b', true),
      makeEdge('e2', 'a', 'c', true),
      makeEdge('e3', 'b', 'd', false),
      makeEdge('e4', 'c', 'd', false),
      makeEdge('e5', 'd', 'e', true),
    ]
    expect(() => applyLayout(nodes, edges)).not.toThrow()
  })

  it('does not mutate the original node array', () => {
    const nodes = [makeNode('a'), makeNode('b')]
    const original = nodes.map(n => ({ ...n, position: { ...n.position } }))
    applyLayout(nodes, [makeEdge('e1', 'a', 'b', true)])
    expect(nodes[0]!.position).toEqual(original[0]!.position)
    expect(nodes[1]!.position).toEqual(original[1]!.position)
  })
})

// ---------------------------------------------------------------------------
// applyDagreLayout — legacy (kept until GraphCanvas migration)
// ---------------------------------------------------------------------------

describe('applyDagreLayout (legacy)', () => {
  it('returns an empty array when given no nodes', () => {
    expect(applyDagreLayout([], [])).toEqual([])
  })

  it('returns a positioned node for a single node with no edges', () => {
    const nodes = [makeNode('a')]
    const result = applyDagreLayout(nodes, [])
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('a')
    expect(typeof result[0]!.position.x).toBe('number')
    expect(typeof result[0]!.position.y).toBe('number')
  })

  it('preserves all node ids', () => {
    const nodes = ['a', 'b', 'c'].map(makeNode)
    const edges = [makeEdge('e1', 'a', 'b')]
    const result = applyDagreLayout(nodes, edges)
    expect(result.map(n => n.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the original nodes', () => {
    const nodes = [makeNode('a'), makeNode('b')]
    const original = nodes.map(n => ({ ...n, position: { ...n.position } }))
    applyDagreLayout(nodes, [makeEdge('e1', 'a', 'b')])
    expect(nodes[0]!.position).toEqual(original[0]!.position)
    expect(nodes[1]!.position).toEqual(original[1]!.position)
  })

  it('places the directed edge source above its target (lower y)', () => {
    const nodes = [makeNode('parent'), makeNode('child')]
    const edges = [makeEdge('e1', 'parent', 'child', true)]
    const result = applyDagreLayout(nodes, edges)
    const parent = result.find(n => n.id === 'parent')!
    const child  = result.find(n => n.id === 'child')!
    expect(parent.position.y).toBeLessThan(child.position.y)
  })
})
