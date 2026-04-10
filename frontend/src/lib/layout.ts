import Dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'

// Match the rendered size of CharacterNode
const NODE_WIDTH  = 120
const NODE_HEIGHT = 72

/**
 * Apply a Dagre hierarchical layout.
 *
 * Directed edges (parent_child, mentor, …) get higher weight so they dominate
 * the rank assignment — the source sits above the target in the hierarchy.
 * Undirected peer edges (sibling, romantic, ally, …) use the same minlen but
 * lower weight, so Dagre prefers to keep peers close without letting them
 * override the directed hierarchy signal.
 *
 * Pure function — returns new node objects with updated positions.
 */
export const applyDagreLayout = (
  nodes: readonly Node[],
  edges: readonly Edge[],
): Node[] => {
  if (nodes.length === 0) return []

  const g = new Dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({
    rankdir: 'TB',   // top-to-bottom hierarchy
    nodesep: 80,     // horizontal gap between nodes in the same rank
    ranksep: 120,    // vertical gap between ranks
    marginx: 60,
    marginy: 60,
  })

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }

  for (const edge of edges) {
    const directed = !!(edge.data as { directed?: boolean } | undefined)?.directed
    if (directed) {
      // Hierarchy edge: high weight so the rank assignment follows the
      // directed relationship.  The target will be ranked strictly below
      // the source.
      g.setEdge(edge.source, edge.target, { minlen: 1, weight: 2 })
    } else {
      // Peer edge: lower weight so it doesn't override directed hierarchy.
      // Adding in both directions lets Dagre treat them symmetrically and
      // tend to place the endpoints on the same rank when unconstrained.
      g.setEdge(edge.source, edge.target, { minlen: 1, weight: 1 })
      g.setEdge(edge.target, edge.source, { minlen: 1, weight: 1 })
    }
  }

  Dagre.layout(g)

  return nodes.map(node => {
    const { x, y } = g.node(node.id)
    return {
      ...node,
      position: {
        x: x - NODE_WIDTH  / 2,
        y: y - NODE_HEIGHT / 2,
      },
    }
  })
}
