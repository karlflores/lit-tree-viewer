import { memo, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import {
  applyNodeChanges,
  Background,
  MarkerType,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import type { Character, GraphSnapshot, Relationship } from '../types/domain'
import { useAnimatedLayout } from '../hooks/useAnimatedLayout'
import { applyLayout } from '../lib/layout'
import { getEdgeStyle } from '../lib/edgeStyles'
import { loadPositions, savePosition } from '../lib/nodePositions'
import CharacterNode, { type CharacterNodeData } from './CharacterNode'
import RelationshipEdge, { type RelationshipEdgeData } from './RelationshipEdge'
import ZoomControls from './ZoomControls'

const nodeTypes = { character: CharacterNode }
const edgeTypes = { relationship: RelationshipEdge }

// ---------------------------------------------------------------------------
// FitViewTrigger — null component that lives inside ReactFlow's provider tree
// so it can safely call useReactFlow(). Exposes fitView via a callback ref and
// fits the viewport the first time nodes actually appear in the graph.
// ---------------------------------------------------------------------------

type FitViewTriggerProps = {
  fitViewRef: MutableRefObject<(() => void) | null>
  nodeCount: number
}

const FitViewTrigger = ({ fitViewRef, nodeCount }: FitViewTriggerProps) => {
  const { fitView } = useReactFlow()

  // Always keep the ref pointing to the latest fitView closure
  fitViewRef.current = useCallback(
    () => fitView({ padding: 0.15, duration: 400 }),
    [fitView],
  )

  // Fit the first time nodes appear — handles async data loading where nodes
  // aren't present at mount time and a fixed timeout would fire too early.
  const hasFitRef = useRef(false)
  useEffect(() => {
    if (nodeCount === 0 || hasFitRef.current) return
    hasFitRef.current = true
    const t = setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50)
    return () => clearTimeout(t)
  }, [nodeCount, fitView])

  return null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const toFlowNode = (
  character: Character,
  atUnit: number,
  selectedId: string | null,
): Node<CharacterNodeData> => ({
  id: character.id,
  type: 'character',
  position: { x: 0, y: 0 },
  data: { character, atUnit, isSelected: character.id === selectedId },
})

const toFlowEdge = (
  relationship: Relationship,
  colours?: Readonly<Record<string, string>>,
): Edge<RelationshipEdgeData> => {
  const style = getEdgeStyle(relationship.kind, relationship.label, colours)
  return {
    id: relationship.id,
    source: relationship.fromId,
    target: relationship.toId,
    type: 'relationship',
    markerEnd: relationship.directed
      ? { type: MarkerType.ArrowClosed, color: style.color, width: 16, height: 16 }
      : undefined,
    data: { kind: relationship.kind, label: relationship.label, directed: relationship.directed, colours },
  }
}

/** Assigns parallelIndex/parallelCount to edges sharing the same node pair. */
function withParallelOffsets(raw: Edge<RelationshipEdgeData>[]): Edge<RelationshipEdgeData>[] {
  const groups = new Map<string, string[]>()
  for (const e of raw) {
    const key = [e.source, e.target].sort().join('|')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(e.id)
  }
  return raw.map(e => {
    const key   = [e.source, e.target].sort().join('|')
    const group = groups.get(key)!
    return { ...e, data: { ...e.data, parallelIndex: group.indexOf(e.id), parallelCount: group.length } as RelationshipEdgeData }
  })
}

const structureKey = (nodes: readonly Node[], edges: readonly Edge[]): string =>
  [
    ...nodes.map(n => n.id).sort(),
    ...edges.map(e => `${e.source}>${e.target}`).sort(),
  ].join('|')

// ---------------------------------------------------------------------------
// AddNodeHandler — places a new node at viewport centre when `trigger` increments.
// Must live inside ReactFlow's provider tree to use useReactFlow().
// ---------------------------------------------------------------------------

type AddNodeHandlerProps = {
  trigger: number
  seriesId: string
  atUnit: number
  savedPositionsRef: MutableRefObject<Map<string, { x: number; y: number }>>
  onAddCharacter: (character: Character) => void
}

const AddNodeHandler = ({ trigger, seriesId, atUnit, savedPositionsRef, onAddCharacter }: AddNodeHandlerProps) => {
  const { screenToFlowPosition } = useReactFlow()
  const prevTriggerRef = useRef(trigger)

  useEffect(() => {
    if (trigger === prevTriggerRef.current) return
    prevTriggerRef.current = trigger

    const pos = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    const id = crypto.randomUUID()

    // Pre-seed position so layout won't override it with Phase 4 incremental placement.
    savedPositionsRef.current.set(id, pos)
    savePosition(seriesId, id, pos)

    onAddCharacter({
      id,
      seriesId,
      name: '',
      aliases: [],
      description: null,
      imageUrl: null,
      introducedAt: atUnit,
      diedAt: null,
    })
  }, [trigger, seriesId, atUnit, savedPositionsRef, screenToFlowPosition, onAddCharacter])

  return null
}

// ---------------------------------------------------------------------------
// GraphCanvas
// ---------------------------------------------------------------------------

type Props = {
  snapshot: GraphSnapshot
  layoutSnapshot: GraphSnapshot
  selectedCharacterId: string | null
  showDeceased: boolean
  onSelectCharacter: (character: Character | null) => void
  menuOpen: boolean
  onCloseMenu: () => void
  addNodeTrigger?: number
  onAddCharacter?: (character: Character) => void
}

const GraphCanvas = memo(({ snapshot, layoutSnapshot, selectedCharacterId, showDeceased, onSelectCharacter, menuOpen, onCloseMenu, addNodeTrigger, onAddCharacter }: Props) => {
  const { characters, relationships, atUnit } = snapshot
  const colours = snapshot.colours

  // ── Layout graph (final chapter — full character set) ────────────────────
  // Positions are computed once on the complete graph so they are stable
  // across all timeline positions. The layout snapshot is always at totalUnits.
  const layoutRawNodes = useMemo(
    () => layoutSnapshot.characters.map(c => toFlowNode(c, layoutSnapshot.atUnit, selectedCharacterId)),
    [layoutSnapshot.characters, layoutSnapshot.atUnit, selectedCharacterId],
  )

  const layoutEdges = useMemo(() => {
    const allIds = new Set(layoutSnapshot.characters.map(c => c.id))
    const raw = layoutSnapshot.relationships
      .filter(r => allIds.has(r.fromId) && allIds.has(r.toId))
      .map(r => toFlowEdge(r, colours))
    return withParallelOffsets(raw)
  }, [layoutSnapshot.relationships, layoutSnapshot.characters, colours])

  // ── Current chapter nodes (for data sync only) ───────────────────────────
  // When the user scrubs the timeline, character names/states can change but
  // positions must not. This array is used only to update node .data fields.
  const currentRawNodes = useMemo(
    () => characters.map(c => toFlowNode(c, atUnit, selectedCharacterId)),
    [characters, atUnit, selectedCharacterId],
  )

  // ── Visible subsets (for display only) ───────────────────────────────────
  const visibleIds = useMemo(() => {
    const ids = showDeceased
      ? characters.map(c => c.id)
      : characters.filter(c => c.diedAt === null || c.diedAt > atUnit).map(c => c.id)
    return new Set(ids)
  }, [characters, atUnit, showDeceased])

  // Display edges — relationships that exist at the current chapter, filtered
  // to visible nodes. Separate from layoutEdges (which span all chapters).
  const visibleEdges = useMemo(() => {
    const currentIds = new Set(characters.map(c => c.id))
    const raw = relationships
      .filter(r => currentIds.has(r.fromId) && currentIds.has(r.toId))
      .map(r => toFlowEdge(r, colours))
    return withParallelOffsets(raw).filter(e => visibleIds.has(e.source) && visibleIds.has(e.target))
  }, [relationships, colours, characters, visibleIds])

  const seriesId = snapshot.series.id

  // Saved positions — loaded once from localStorage and updated on every drag end.
  const savedPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const isFirstLayoutRef = useRef(true)
  if (isFirstLayoutRef.current) {
    savedPositionsRef.current = loadPositions(seriesId)
    isFirstLayoutRef.current = false
  }

  const [layoutNodes, setLayoutNodes] = useState<Node[]>([])
  const prevStructureKeyRef = useRef('')

  // Ref mirror of currentRawNodes — always up to date, but reading it inside
  // the layout effect does not add it to that effect's dependency array.
  // This prevents chapter scrubs from re-triggering the (expensive) layout.
  const currentRawNodesRef = useRef(currentRawNodes)
  useEffect(() => { currentRawNodesRef.current = currentRawNodes })

  // ── Effect 1: layout ─────────────────────────────────────────────────────
  // Fires only when the full-graph structure changes (characters or edges
  // added/removed). Runs the force algorithm and caches all positions so
  // subsequent chapter scrubs never need to re-layout.
  //
  // Immediately overlays current-chapter display data after computing positions.
  // Without this, nodes would briefly (or permanently, if Effect 2 doesn't
  // re-fire) show state from the layout snapshot's final chapter — e.g. a
  // character who dies in chapter 5 appearing deceased when viewing chapter 1.
  useEffect(() => {
    const key = structureKey(layoutRawNodes, layoutEdges)
    if (key === prevStructureKeyRef.current) return
    prevStructureKeyRef.current = key
    const laid = applyLayout(layoutRawNodes, layoutEdges, savedPositionsRef.current)
    for (const n of laid) {
      savedPositionsRef.current.set(n.id, n.position)
    }
    const currentDataMap = new Map(currentRawNodesRef.current.map(n => [n.id, n.data]))
    setLayoutNodes(laid.map(n => {
      const d = currentDataMap.get(n.id)
      return d ? { ...n, data: d } : n
    }))
  }, [layoutRawNodes, layoutEdges])

  // ── Effect 2: data sync ───────────────────────────────────────────────────
  // Fires when the displayed chapter changes. Updates character names, alive/
  // deceased state, and selection — without touching any node positions.
  useEffect(() => {
    setLayoutNodes(prev => prev.map(n => {
      const updated = currentRawNodes.find(rn => rn.id === n.id)
      return updated ? { ...n, data: updated.data } : n
    }))
  }, [currentRawNodes])

  // allAnimatedNodes holds interpolated positions for every character.
  // Filter to visibleIds before passing to ReactFlow.
  const [allAnimatedNodes, setAnimatedNodes] = useAnimatedLayout(layoutNodes)

  const animatedNodes = useMemo(
    () => allAnimatedNodes.filter(n => visibleIds.has(n.id)),
    [allAnimatedNodes, visibleIds],
  )

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    // Apply position changes to the full node set so dragged positions survive
    // even when a node is temporarily hidden by the timeline.
    setAnimatedNodes(prev => applyNodeChanges(changes, prev) as Node[])

    changes.forEach(change => {
      if (change.type === 'position' && change.dragging === false && change.position) {
        const { id, position } = change
        savedPositionsRef.current.set(id, position)
        savePosition(seriesId, id, position)
        setLayoutNodes(prev => prev.map(n => n.id === id ? { ...n, position } : n))
      }
    })
  }, [setAnimatedNodes])

  // fitViewRef is populated by FitViewTrigger (which lives inside the ReactFlow
  // provider) and gives us reliable access to fitView without onInit gymnastics.
  const fitViewRef = useRef<(() => void) | null>(null)

  // Auto-layout: clear saved positions and re-run on the full graph, then fit.
  const handleAutoLayout = useCallback(() => {
    savedPositionsRef.current = new Map()
    try {
      localStorage.removeItem(`litree:positions:${seriesId}`)
    } catch { /* ignore */ }
    prevStructureKeyRef.current = ''
    const laid = applyLayout(layoutRawNodes, layoutEdges)
    for (const n of laid) {
      savedPositionsRef.current.set(n.id, n.position)
    }
    setLayoutNodes(laid)
    setTimeout(() => fitViewRef.current?.(), 600)
  }, [layoutRawNodes, layoutEdges, seriesId])

  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    if (node.id === selectedCharacterId) {
      onSelectCharacter(null)
    } else {
      const character = characters.find(c => c.id === node.id) ?? null
      onSelectCharacter(character)
    }
  }, [characters, selectedCharacterId, onSelectCharacter])

  const onPaneClick = useCallback(() => {
    onSelectCharacter(null)
    if (menuOpen) onCloseMenu()
  }, [onSelectCharacter, onCloseMenu, menuOpen])

  return (
    <ReactFlow
      nodes={animatedNodes}
      edges={visibleEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={handleNodesChange}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      nodesDraggable
      minZoom={0.1}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <FitViewTrigger fitViewRef={fitViewRef} nodeCount={animatedNodes.length} />
      {addNodeTrigger !== undefined && onAddCharacter && (
        <AddNodeHandler
          trigger={addNodeTrigger}
          seriesId={snapshot.series.id}
          atUnit={atUnit}
          savedPositionsRef={savedPositionsRef}
          onAddCharacter={onAddCharacter}
        />
      )}
      <Background color="#2a2d3a" gap={24} size={1} />
      <ZoomControls onAutoLayout={handleAutoLayout} />
    </ReactFlow>
  )
})

GraphCanvas.displayName = 'GraphCanvas'
export default GraphCanvas
