import { memo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react'
import type { RelationshipKind } from '../types/domain'
import { getEdgeStyle } from '../lib/edgeStyles'

export type RelationshipEdgeData = {
  kind: RelationshipKind
  label: string | null
  directed: boolean
}

const RelationshipEdge = memo((props: EdgeProps) => {
  const {
    id, sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition, data, markerEnd,
  } = props

  const edgeData = data as RelationshipEdgeData
  const style = getEdgeStyle(edgeData.kind)

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  })

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={edgeData.directed ? markerEnd : undefined}
        style={{ stroke: style.color, strokeWidth: 1.5, strokeDasharray: style.strokeDasharray }}
      />
      {edgeData.label && (
        <EdgeLabelRenderer>
          <div
            className="absolute pointer-events-none px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface border border-border"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              color: style.color,
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
