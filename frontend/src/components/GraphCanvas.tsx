import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyNodeChanges,
  Background,
  MarkerType,
  Panel,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import type { Character, GraphSnapshot, Relationship } from '../types/domain'
import { useAnimatedLayout } from '../hooks/useAnimatedLayout'
import { applyDagreLayout } from '../lib/layout'
import { getEdgeStyle } from '../lib/edgeStyles'
import { loadPositions, savePosition } from '../lib/nodePositions'
import CharacterNode, { type CharacterNodeData } from './CharacterNode'
import RelationshipEdge, { type RelationshipEdgeData } from './RelationshipEdge'
import ZoomControls from './ZoomControls'

const nodeTypes = { character: CharacterNode }
const edgeTypes = { relationship: RelationshipEdge }

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

const toFlowEdge = (relationship: Relationship): Edge<RelationshipEdgeData> => {
  const style = getEdgeStyle(relationship.kind, relationship.label)
  return {
    id: relationship.id,
    source: relationship.fromId,
    target: relationship.toId,
    type: 'relationship',
    markerEnd: relationship.directed
      ? { type: MarkerType.ArrowClosed, color: style.color, width: 16, height: 16 }
      : undefined,
    data: { kind: relationship.kind, label: relationship.label, directed: relationship.directed },
  }
}

const structureKey = (nodes: readonly Node[], edges: readonly Edge[]): string =>
  [
    ...nodes.map(n => n.id).sort(),
    ...edges.map(e => `${e.source}>${e.target}`).sort(),
  ].join('|')

type Props = {
  snapshot: GraphSnapshot
  selectedCharacterId: string | null
  showDeceased: boolean
  onSelectCharacter: (character: Character | null) => void
  menuOpen: boolean
  onToggleMenu: () => void
  onCloseMenu: () => void
}

const GraphCanvas = memo(({ snapshot, selectedCharacterId, showDeceased, onSelectCharacter, menuOpen, onToggleMenu, onCloseMenu }: Props) => {
  const { characters, relationships, atUnit } = snapshot

  const visibleCharacters = useMemo(
    () => showDeceased
      ? characters
      : characters.filter(c => c.diedAt === null || c.diedAt > atUnit),
    [characters, atUnit, showDeceased],
  )

  const visibleIds = useMemo(
    () => new Set(visibleCharacters.map(c => c.id)),
    [visibleCharacters],
  )

  const visibleRelationships = useMemo(
    () => relationships.filter(r => visibleIds.has(r.fromId) && visibleIds.has(r.toId)),
    [relationships, visibleIds],
  )

  const rawNodes = useMemo(
    () => visibleCharacters.map(c => toFlowNode(c, atUnit, selectedCharacterId)),
    [visibleCharacters, atUnit, selectedCharacterId],
  )

  const edges = useMemo(
    () => visibleRelationships.map(toFlowEdge),
    [visibleRelationships],
  )

  const seriesId = snapshot.series.id

  // Saved positions — loaded once from localStorage and updated on every drag end.
  // Keyed by character ID so positions survive chapter changes and re-layouts.
  const savedPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const isFirstLayoutRef = useRef(true)
  if (isFirstLayoutRef.current) {
    // Initialise synchronously before first render so the first layout uses them.
    savedPositionsRef.current = loadPositions(seriesId)
    isFirstLayoutRef.current = false
  }

  // layoutNodes holds the target positions passed to the animation hook.
  // Drag end also writes back here so data-only chapter changes preserve manual positioning.
  const [layoutNodes, setLayoutNodes] = useState<Node[]>([])
  const prevStructureKeyRef = useRef('')

  useEffect(() => {
    const key = structureKey(rawNodes, edges)

    if (key === prevStructureKeyRef.current) {
      // Data-only change: sync updated data without touching positions.
      setLayoutNodes(prev => prev.map(n => {
        const updated = rawNodes.find(rn => rn.id === n.id)
        return updated ? { ...n, data: updated.data } : n
      }))
    } else {
      prevStructureKeyRef.current = key
      // Apply dagre layout then override with any saved positions.
      const dagreNodes = applyDagreLayout(rawNodes, edges)
      setLayoutNodes(dagreNodes.map(n => {
        const saved = savedPositionsRef.current.get(n.id)
        return saved ? { ...n, position: saved } : n
      }))
    }
  }, [rawNodes, edges])

  // animatedNodes interpolates layoutNodes → display positions.
  // setAnimatedNodes is the raw setter used by drag to bypass animation.
  const [animatedNodes, setAnimatedNodes] = useAnimatedLayout(layoutNodes)

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    // Apply all position changes directly — drag must update every pointer-move
    // frame without any animation lag.
    setAnimatedNodes(prev => applyNodeChanges(changes, prev) as Node[])

    // On drag end, persist the final position so it survives chapter changes
    // and page reloads. Write to both the in-memory map and localStorage.
    changes.forEach(change => {
      if (change.type === 'position' && change.dragging === false && change.position) {
        const { id, position } = change
        savedPositionsRef.current.set(id, position)
        savePosition(seriesId, id, position)
        setLayoutNodes(prev => prev.map(n => n.id === id ? { ...n, position } : n))
      }
    })
  }, [setAnimatedNodes])

  const hasFitRef = useRef(false)
  const handleInit = useCallback((instance: { fitView: (opts?: object) => void }) => {
    if (hasFitRef.current) return
    hasFitRef.current = true
    setTimeout(() => instance.fitView({ padding: 0.2, duration: 300 }), 550)
  }, [])

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
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={handleNodesChange}
      onInit={handleInit}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      nodesDraggable
      minZoom={0.3}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#2a2d3a" gap={24} size={1} />
      {!menuOpen && (
        <Panel position="top-left">
          <div className="rounded-3xl border border-border bg-panel shadow-xl overflow-hidden">
            <button
              onClick={onToggleMenu}
              aria-label="Open menu"
              className="w-11 h-11 flex flex-col items-center justify-center gap-[4px] text-white/40 hover:text-white hover:bg-white/10 active:bg-white/20 transition-colors"
            >
              <span className="block w-[15px] h-[1.4px] bg-current rounded-full" />
              <span className="block w-[15px] h-[1.4px] bg-current rounded-full" />
              <span className="block w-[15px] h-[1.4px] bg-current rounded-full" />
            </button>
          </div>
        </Panel>
      )}
      <ZoomControls />
    </ReactFlow>
  )
})

GraphCanvas.displayName = 'GraphCanvas'
export default GraphCanvas
