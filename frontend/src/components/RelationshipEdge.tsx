import { memo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Position,
  useInternalNode,
  type EdgeProps,
} from '@xyflow/react'
import type { RelationshipKind } from '../types/domain'
import { getEdgeStyle } from '../lib/edgeStyles'

export type RelationshipEdgeData = {
  kind?:          RelationshipKind   // absent for LTG-imported relationships
  label:          string
  directed:       boolean
  colours?:       Readonly<Record<string, string>>
  parallelIndex?: number             // 0-based index within a parallel group
  parallelCount?: number             // total edges sharing this node pair
}

// Fallback dimensions if the node hasn't been measured yet
const FALLBACK_W = 120
const FALLBACK_H = 72

const BASE_CURVATURE        = 0.25
// How much curvature shifts per parallel edge so they fan out visually.
const PARALLEL_CURVATURE_STEP = 0.35

// ---------------------------------------------------------------------------
// Anchor helpers
// ---------------------------------------------------------------------------

type Anchor = { x: number; y: number; position: Position }

/**
 * Returns the 4 midpoint anchors for a node (top, bottom, left, right sides).
 * Coordinates are in absolute canvas space.
 */
function getAnchors(nx: number, ny: number, w: number, h: number): Anchor[] {
  const cx = nx + w / 2
  const cy = ny + h / 2
  return [
    { x: cx,      y: ny,      position: Position.Top    },
    { x: cx,      y: ny + h,  position: Position.Bottom },
    { x: nx,      y: cy,      position: Position.Left   },
    { x: nx + w,  y: cy,      position: Position.Right  },
  ]
}

/**
 * Finds the (source anchor, target anchor) pair with the smallest straight-line
 * distance. The winning pair determines where the bezier starts/ends and the
 * direction of its control-point handles, so edges naturally exit and enter
 * from the closest faces of each node.
 */
function closestAnchorPair(src: Anchor[], tgt: Anchor[]): [Anchor, Anchor] {
  let bestSrc  = src[0]!
  let bestTgt  = tgt[0]!
  let bestDist = Infinity

  for (const s of src) {
    for (const t of tgt) {
      const dx = s.x - t.x
      const dy = s.y - t.y
      const d  = dx * dx + dy * dy   // compare squared distances — no sqrt needed
      if (d < bestDist) {
        bestDist = d
        bestSrc  = s
        bestTgt  = t
      }
    }
  }

  return [bestSrc, bestTgt]
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const RelationshipEdge = memo((props: EdgeProps) => {
  const { id, source, target, data, markerEnd } = props

  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)

  const edgeData = data as RelationshipEdgeData
  const style    = getEdgeStyle(edgeData.kind, edgeData.label, edgeData.colours)

  if (!sourceNode || !targetNode) return null

  const sw = sourceNode.measured?.width  ?? FALLBACK_W
  const sh = sourceNode.measured?.height ?? FALLBACK_H
  const tw = targetNode.measured?.width  ?? FALLBACK_W
  const th = targetNode.measured?.height ?? FALLBACK_H

  const srcPos = sourceNode.internals.positionAbsolute
  const tgtPos = targetNode.internals.positionAbsolute

  const [srcAnchor, tgtAnchor] = closestAnchorPair(
    getAnchors(srcPos.x, srcPos.y, sw, sh),
    getAnchors(tgtPos.x, tgtPos.y, tw, th),
  )

  // Vary curvature for edges that share the same node pair so they spread apart.
  const n         = edgeData.parallelCount ?? 1
  const idx       = edgeData.parallelIndex ?? 0
  const curvature = BASE_CURVATURE + (idx - (n - 1) / 2) * PARALLEL_CURVATURE_STEP

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX:        srcAnchor.x,
    sourceY:        srcAnchor.y,
    sourcePosition: srcAnchor.position,
    targetX:        tgtAnchor.x,
    targetY:        tgtAnchor.y,
    targetPosition: tgtAnchor.position,
    curvature,
  })

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={edgeData.directed ? markerEnd : undefined}
        style={{
          stroke:          style.color,
          strokeWidth:     1.5,
          strokeDasharray: style.strokeDasharray,
        }}
      />
      {edgeData.label && (
        <EdgeLabelRenderer>
          <div
            className="absolute pointer-events-none px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface border border-border"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              color:     style.color,
            }}
          >
            {edgeData.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
})

RelationshipEdge.displayName = 'RelationshipEdge'
export default RelationshipEdge
