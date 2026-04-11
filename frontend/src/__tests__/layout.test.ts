import { describe, it, expect } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import { applyDagreLayout } from '../lib/layout'

const makeNode = (id: string): Node => ({
  id,
  position: { x: 0, y: 0 },
  data: {},
})

const makeEdge = (id: string, source: string, target: string, directed = false): Edge => ({
  id,
  source,
  target,
  data: { directed },
})

describe('applyDagreLayout', () => {
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
    const resultIds = result.map(n => n.id).sort()
    expect(resultIds).toEqual(['a', 'b', 'c'])
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
    // Dagre TB layout: higher-ranked nodes have smaller y values
    expect(parent.position.y).toBeLessThan(child.position.y)
  })
})
