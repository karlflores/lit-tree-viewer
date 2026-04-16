import { useCallback } from 'react'
import { useReactFlow, Panel, useNodes, useEdges, type Node, type Edge } from '@xyflow/react'

// Returns the IDs of nodes in the largest connected component (undirected).
const findLargestSubgraphIds = (nodes: readonly Node[], edges: readonly Edge[]): Set<string> => {
  const adj = new Map<string, Set<string>>(nodes.map(n => [n.id, new Set()]))
  edges.forEach(e => {
    adj.get(e.source)?.add(e.target)
    adj.get(e.target)?.add(e.source)
  })

  const visited = new Set<string>()
  let largest: string[] = []

  for (const node of nodes) {
    if (visited.has(node.id)) continue
    const component: string[] = []
    const queue: string[] = [node.id]
    while (queue.length > 0) {
      const id = queue.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      component.push(id)
      adj.get(id)?.forEach(nid => { if (!visited.has(nid)) queue.push(nid) })
    }
    if (component.length > largest.length) largest = component
  }

  return new Set(largest)
}

type Props = {
  onAutoLayout?: () => void
}

const ZoomControls = ({ onAutoLayout }: Props) => {
  const { zoomIn, zoomOut, setCenter, getZoom } = useReactFlow()
  const nodes = useNodes()
  const edges = useEdges()

  const handleCenterLargest = useCallback(() => {
    if (nodes.length === 0) return

    const ids = findLargestSubgraphIds(nodes, edges)
    const sub = nodes.filter(n => ids.has(n.id))

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    sub.forEach(n => {
      const w = n.measured?.width  ?? 160
      const h = n.measured?.height ?? 80
      minX = Math.min(minX, n.position.x)
      minY = Math.min(minY, n.position.y)
      maxX = Math.max(maxX, n.position.x + w)
      maxY = Math.max(maxY, n.position.y + h)
    })

    setCenter(
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      { zoom: getZoom(), duration: 400 },
    )
  }, [nodes, edges, setCenter, getZoom])

  return (
    <Panel position="top-right">
      <div className="flex flex-col gap-2 items-stretch">

        {/* Auto-layout */}
        {onAutoLayout && (
          <div className="flex flex-col rounded-full border border-border bg-panel shadow-lg overflow-hidden">
            <button
              onClick={onAutoLayout}
              disabled={nodes.length === 0}
              aria-label="Auto layout"
              title="Auto layout"
              className="w-10 h-10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 active:bg-white/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {/* Grid/auto-fit icon */}
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                <rect x="1"   y="1"   width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
                <rect x="9"   y="1"   width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
                <rect x="1"   y="9"   width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
                <rect x="9"   y="9"   width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </button>
          </div>
        )}

        {/* Center on largest subgraph */}
        <div className="flex flex-col rounded-full border border-border bg-panel shadow-lg overflow-hidden">
          <button
            onClick={handleCenterLargest}
            aria-label="Center on largest group"
            className="w-10 h-10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 active:bg-white/20 transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
              <circle cx="7.5" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1.4" />
              <line x1="7.5" y1="1"    x2="7.5" y2="4.5"  stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <line x1="7.5" y1="10.5" x2="7.5" y2="14"   stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <line x1="1"   y1="7.5"  x2="4.5" y2="7.5"  stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <line x1="10.5" y1="7.5" x2="14"  y2="7.5"  stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Zoom in / out */}
        <div className="flex flex-col rounded-full border border-border bg-panel shadow-lg overflow-hidden">
          <button
            onClick={() => zoomIn({ duration: 200 })}
            aria-label="Zoom in"
            className="w-10 h-10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 active:bg-white/20 transition-colors"
          >
            <span className="text-xl font-thin leading-none select-none">+</span>
          </button>

          <div className="h-px bg-border mx-2" />

          <button
            onClick={() => zoomOut({ duration: 200 })}
            aria-label="Zoom out"
            className="w-10 h-10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 active:bg-white/20 transition-colors"
          >
            <span className="text-xl font-thin leading-none select-none">−</span>
          </button>
        </div>

      </div>
    </Panel>
  )
}

export default ZoomControls
