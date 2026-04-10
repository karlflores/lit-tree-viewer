import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react'
import type { Node } from '@xyflow/react'

const DURATION = 500

const easeInOut = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/**
 * Interpolates node positions from their previous values to new target values
 * via requestAnimationFrame. Because React Flow derives edge paths from node
 * positions, edges animate in sync automatically.
 *
 * Returns a tuple of [animatedNodes, setNodes]. The raw setter bypasses the
 * animation loop — use it for drag events that must update positions immediately
 * on every pointer move.
 *
 * Data-only changes (selection, deceased state) are applied immediately without
 * triggering the animation loop.
 */
export const useAnimatedLayout = (
  targetNodes: Node[],
): [Node[], Dispatch<SetStateAction<Node[]>>] => {
  const [nodes, setNodes] = useState(targetNodes)

  // Always reflects the latest rendered positions, even mid-animation.
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes

  const rafRef = useRef(0)

  useEffect(() => {
    // Snapshot positions at the moment targetNodes changes so we always
    // animate from the current visual position, not the previous target.
    const startPositions = new Map(nodesRef.current.map(n => [n.id, n.position]))

    const hasPositionChange = targetNodes.some(n => {
      const start = startPositions.get(n.id)
      if (!start) return false // new node — CharacterNode opacity handles the entrance
      return (
        Math.abs(start.x - n.position.x) > 0.5 ||
        Math.abs(start.y - n.position.y) > 0.5
      )
    })

    cancelAnimationFrame(rafRef.current)

    if (!hasPositionChange) {
      setNodes(targetNodes)
      return
    }

    const startTime = performance.now()

    const tick = (now: number) => {
      const t     = Math.min((now - startTime) / DURATION, 1)
      const eased = easeInOut(t)

      setNodes(
        targetNodes.map(node => {
          const start = startPositions.get(node.id)
          if (!start) return node // new node — start at final position
          return {
            ...node,
            position: {
              x: lerp(start.x, node.position.x, eased),
              y: lerp(start.y, node.position.y, eased),
            },
          }
        })
      )

      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [targetNodes])

  return [nodes, setNodes]
}
