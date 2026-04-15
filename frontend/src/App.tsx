import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Character, GraphSnapshot, Relationship } from './types/domain'
import type { Edge } from '@xyflow/react'
import { useGraphData } from './hooks/useGraphData'
import { useFullGraph } from './hooks/useFullGraph'
import { useCompiledGraph } from './hooks/useCompiledGraph'
import { compiledToSnapshot } from './lib/ltgCompiler'
import type { CompileSuccess } from './lib/ltgLspClient'
import { emitLtg } from './lib/ltgEmitter'
import { editableToSnapshot } from './lib/editableToSnapshot'
import { createEmptyGraph, saveEditGraph, loadEditGraph, saveViewerGraph, loadViewerGraph } from './lib/editGraphSession'
import { useNotificationStore } from './lib/notificationStore'
import GraphCanvas from './components/GraphCanvas'
import TimelineScrubber from './components/TimelineScrubber'
import CharacterPanel from './components/CharacterPanel'
import MenuPanel from './components/MenuPanel'
import CodeEditorPanel from './components/CodeEditorPanel'
import SideToolbar from './components/SideToolbar'
import CharacterEditPanel from './components/CharacterEditPanel'
import RelationshipEditPanel from './components/RelationshipEditPanel'
import NodeContextMenu from './components/NodeContextMenu'
import ConfirmDialog from './components/ConfirmDialog'
import GraphMetadataPanel from './components/GraphMetadataPanel'
import ToolbarButton from './components/ToolbarButton'
import NotificationStack from './components/NotificationStack'
import Toggle from './components/Toggle'

const SERIES_ID = '00000000-0000-0000-0000-000000000001'
const PANEL_CLOSE_MS = 250

export default function App() {
  const [currentUnit, setCurrentUnit] = useState(1)
  const [showDeceased, setShowDeceased] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [editGraph, setEditGraph] = useState<GraphSnapshot | null>(null)
  // viewerGraph: the last explicitly saved edit graph — shown in viewer mode after exiting edit.
  const [viewerGraph, setViewerGraph] = useState<GraphSnapshot | null>(() => loadViewerGraph())
  // editBaseGraph: the state of editGraph when edit mode was last entered or saved.
  // Used for dirty checking — any reference inequality means unsaved changes.
  const editBaseRef = useRef<GraphSnapshot | null>(null)
  const [showExitConfirm, setShowExitConfirm] = useState(false)

  const addToast = useNotificationStore(s => s.addToast)

  // Resume any in-progress edit session from sessionStorage on mount.
  useEffect(() => {
    const saved = loadEditGraph()
    if (saved) {
      setEditGraph(saved)
      editBaseRef.current = saved
      setEditMode(true)
      setCurrentUnit(1)
    }
  }, [])

  // panelCharacter: the character currently rendered in the panel (stays non-null
  // during the close animation so the panel has something to display while sliding out).
  // panelOpen: drives the CSS translate transition — false triggers the slide-out.
  const [panelCharacter, setPanelCharacter] = useState<Character | null>(null)
  const [panelOpen, setPanelOpen]           = useState(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openRafRef    = useRef<number | null>(null)

  const [panelRelationship, setPanelRelationship] = useState<Relationship | null>(null)
  const [relPanelOpen, setRelPanelOpen]           = useState(false)
  const relCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const relOpenRafRef    = useRef<number | null>(null)

  const [metadataPanelOpen, setMetadataPanelOpen] = useState(false)

  const [contextMenuNodeId, setContextMenuNodeId] = useState<string | null>(null)
  const [contextMenuPos, setContextMenuPos]       = useState<{ x: number; y: number } | null>(null)

  const [menuMounted, setMenuMounted] = useState(false)
  const [menuOpen, setMenuOpen]       = useState(false)
  const menuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const menuOpenRafRef    = useRef<number | null>(null)

  const [editorMounted, setEditorMounted] = useState(false)
  const [editorOpen, setEditorOpen]       = useState(false)
  const editorCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editorOpenRafRef    = useRef<number | null>(null)

  // Cancel all pending timers and RAFs on unmount (StrictMode / HMR safety).
  useEffect(() => {
    return () => {
      if (closeTimerRef.current)              clearTimeout(closeTimerRef.current)
      if (openRafRef.current !== null)         cancelAnimationFrame(openRafRef.current)
      if (relCloseTimerRef.current)           clearTimeout(relCloseTimerRef.current)
      if (relOpenRafRef.current !== null)      cancelAnimationFrame(relOpenRafRef.current)
      if (menuCloseTimerRef.current)          clearTimeout(menuCloseTimerRef.current)
      if (menuOpenRafRef.current !== null)     cancelAnimationFrame(menuOpenRafRef.current)
      if (editorCloseTimerRef.current)        clearTimeout(editorCloseTimerRef.current)
      if (editorOpenRafRef.current !== null)   cancelAnimationFrame(editorOpenRafRef.current)
    }
  }, [])

  const handleCloseMenu = useCallback(() => {
    if (menuOpenRafRef.current !== null) {
      cancelAnimationFrame(menuOpenRafRef.current)
      menuOpenRafRef.current = null
    }
    setMenuOpen(false)
    menuCloseTimerRef.current = setTimeout(() => setMenuMounted(false), PANEL_CLOSE_MS)
  }, [])

  const handleToggleMenu = useCallback(() => {
    if (menuCloseTimerRef.current) clearTimeout(menuCloseTimerRef.current)
    if (menuOpenRafRef.current !== null) {
      cancelAnimationFrame(menuOpenRafRef.current)
      menuOpenRafRef.current = null
    }

    if (!menuMounted) {
      // Not yet mounted — mount then open on next frame so the translate
      // transition fires from the closed position.
      setMenuMounted(true)
      menuOpenRafRef.current = requestAnimationFrame(() => {
        menuOpenRafRef.current = null
        setMenuOpen(true)
      })
    } else if (menuOpen) {
      // Currently open — animate closed then unmount.
      setMenuOpen(false)
      menuCloseTimerRef.current = setTimeout(() => setMenuMounted(false), PANEL_CLOSE_MS)
    } else {
      // Mounted but mid-close animation — reverse back to open.
      setMenuOpen(true)
    }
  }, [menuMounted, menuOpen])

  const handleCloseEditor = useCallback(() => {
    if (editorOpenRafRef.current !== null) {
      cancelAnimationFrame(editorOpenRafRef.current)
      editorOpenRafRef.current = null
    }
    setEditorOpen(false)
    editorCloseTimerRef.current = setTimeout(() => setEditorMounted(false), PANEL_CLOSE_MS)
  }, [])

  const handleOpenEditor = useCallback(() => {
    // Close menu first so it slides out while the editor slides in.
    handleCloseMenu()

    if (editorCloseTimerRef.current) clearTimeout(editorCloseTimerRef.current)
    if (editorOpenRafRef.current !== null) {
      cancelAnimationFrame(editorOpenRafRef.current)
      editorOpenRafRef.current = null
    }

    if (!editorMounted) {
      setEditorMounted(true)
      editorOpenRafRef.current = requestAnimationFrame(() => {
        editorOpenRafRef.current = null
        setEditorOpen(true)
      })
    } else {
      setEditorOpen(true)
    }
  }, [editorMounted, handleCloseMenu])

  const handleToggleEditor = useCallback(() => {
    if (editorOpen) {
      handleCloseEditor()
    } else {
      handleOpenEditor()
    }
  }, [editorOpen, handleCloseEditor, handleOpenEditor])

  const handleSelectCharacter = useCallback((character: Character | null) => {
    if (character) setMetadataPanelOpen(false)
    // Close the relationship panel when opening a character panel and vice versa.
    if (character && relOpenRafRef.current !== null) {
      cancelAnimationFrame(relOpenRafRef.current)
      relOpenRafRef.current = null
    }
    if (character) {
      setRelPanelOpen(false)
      relCloseTimerRef.current = setTimeout(() => setPanelRelationship(null), PANEL_CLOSE_MS)
    }

    if (openRafRef.current !== null) {
      cancelAnimationFrame(openRafRef.current)
      openRafRef.current = null
    }
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)

    if (character) {
      setPanelCharacter(character)
      openRafRef.current = requestAnimationFrame(() => {
        openRafRef.current = null
        setPanelOpen(true)
      })
    } else {
      setPanelOpen(false)
      closeTimerRef.current = setTimeout(() => setPanelCharacter(null), PANEL_CLOSE_MS)
    }
  }, [])

  const handleSelectRelationship = useCallback((rel: Relationship | null) => {
    if (rel) setMetadataPanelOpen(false)
    // Close the character panel when opening a relationship panel.
    if (rel && openRafRef.current !== null) {
      cancelAnimationFrame(openRafRef.current)
      openRafRef.current = null
    }
    if (rel) {
      setPanelOpen(false)
      closeTimerRef.current = setTimeout(() => setPanelCharacter(null), PANEL_CLOSE_MS)
    }

    if (relOpenRafRef.current !== null) {
      cancelAnimationFrame(relOpenRafRef.current)
      relOpenRafRef.current = null
    }
    if (relCloseTimerRef.current) clearTimeout(relCloseTimerRef.current)

    if (rel) {
      setPanelRelationship(rel)
      relOpenRafRef.current = requestAnimationFrame(() => {
        relOpenRafRef.current = null
        setRelPanelOpen(true)
      })
    } else {
      setRelPanelOpen(false)
      relCloseTimerRef.current = setTimeout(() => setPanelRelationship(null), PANEL_CLOSE_MS)
    }
  }, [])

  const graphData      = useGraphData(SERIES_ID, currentUnit)

  // Full graph (all characters, all relationships, no temporal filter) — fetched
  // once and cached indefinitely. Replaces the second per-chapter fetch previously
  // used for layout and edit-mode entry.
  const fullGraphData  = useFullGraph(SERIES_ID)

  // Compiled graph (identifier-resolved, block-structured) — fetched once so
  // "Open in Editor" is instant rather than waiting on a click-time request.
  const compiledGraphData = useCompiledGraph(SERIES_ID)

  // Local graph set by the editor's "Render" button — overrides the fetched snapshot.
  const [localGraph, setLocalGraph] = useState<CompileSuccess | null>(null)

  // Content to push into the code editor (set by "Open in Editor" toolbar button).
  const [editorContent, setEditorContent] = useState<string | null>(null)

  const handleOpenInEditor = useCallback(() => {
    // Prefer a locally compiled graph (from the editor's Render button); fall
    // back to the eagerly-prefetched compiled graph from the backend.
    const compiled = localGraph ?? (compiledGraphData.status === 'success' ? compiledGraphData.graph : null)
    if (!compiled) return
    const ltg = emitLtg(compiled)
    setEditorContent(ltg)
    handleOpenEditor()
  }, [localGraph, compiledGraphData, handleOpenEditor])

  const localSnapshot = useMemo(
    () => localGraph ? compiledToSnapshot(localGraph, currentUnit) : null,
    [localGraph, currentUnit],
  )

  const fullLocalSnapshot = useMemo(
    () => localGraph
      ? compiledToSnapshot(localGraph, (localGraph.series as { totalUnits: number }).totalUnits)
      : null,
    [localGraph],
  )

  // Edit mode snapshots — highest priority only while actively in edit mode.
  // Gated on editMode so toggling "Edit Mode" off immediately restores the
  // localGraph / backend snapshot without clearing editGraph from state.
  const editableSnapshot = useMemo(
    () => (editMode && editGraph) ? editableToSnapshot(editGraph, currentUnit) : null,
    [editMode, editGraph, currentUnit],
  )
  const fullEditableSnapshot = useMemo(
    () => (editMode && editGraph) ? editableToSnapshot(editGraph, editGraph.series.totalUnits) : null,
    [editMode, editGraph],
  )

  // Viewer graph snapshots — shown after exiting edit mode when a graph has been saved.
  const viewerSnapshot = useMemo(
    () => viewerGraph ? editableToSnapshot(viewerGraph, currentUnit) : null,
    [viewerGraph, currentUnit],
  )
  const fullViewerSnapshot = useMemo(
    () => viewerGraph ? editableToSnapshot(viewerGraph, viewerGraph.series.totalUnits) : null,
    [viewerGraph],
  )

  const layoutSnapshot =
    fullEditableSnapshot ??
    fullViewerSnapshot ??
    fullLocalSnapshot ??
    (fullGraphData.status === 'success' ? fullGraphData.snapshot : null) ??
    localSnapshot ??
    (graphData.status === 'success' ? graphData.snapshot : null)

  const handleCompileAndRender = useCallback((graph: CompileSuccess) => {
    setLocalGraph(graph)
    // Clamp currentUnit to the new graph's range.
    const total = (graph.series as { totalUnits: number }).totalUnits
    setCurrentUnit(prev => Math.min(prev, total))
  }, [])

  const handleAddChapter = useCallback(() => {
    if (!editGraph) return
    const newTotal = editGraph.series.totalUnits + 1
    const next = {
      ...editGraph,
      series: { ...editGraph.series, totalUnits: newTotal },
    }
    setEditGraph(next)
    saveEditGraph(next)
    setCurrentUnit(newTotal)
  }, [editGraph])

  const handleRemoveChapter = useCallback(() => {
    if (!editGraph) return
    if (editGraph.series.totalUnits === 1) {
      addToast({ kind: 'warning', title: 'Cannot remove the only chapter' })
      return
    }
    const newTotal = editGraph.series.totalUnits - 1
    const characters = editGraph.characters.map(c =>
      c.diedAt !== null && c.diedAt > newTotal ? { ...c, diedAt: null } : c,
    )
    const relationships = editGraph.relationships
      .filter(r => r.introducedAt <= newTotal)
      .map(r => r.endedAt !== null && r.endedAt > newTotal ? { ...r, endedAt: null } : r)
    const next = {
      ...editGraph,
      series: { ...editGraph.series, totalUnits: newTotal },
      characters,
      relationships,
    }
    setEditGraph(next)
    saveEditGraph(next)
    setCurrentUnit(prev => Math.min(prev, newTotal))
  }, [editGraph, addToast])

  const handleNewGraph = useCallback(() => {
    const graph = createEmptyGraph()
    saveEditGraph(graph)
    setEditGraph(graph)
    editBaseRef.current = graph
    setEditMode(true)
    setCurrentUnit(1)
  }, [])

  const handleSaveGraph = useCallback(() => {
    if (!editGraph) return
    saveEditGraph(editGraph)
    saveViewerGraph(editGraph)
    setViewerGraph(editGraph)
    editBaseRef.current = editGraph  // reset dirty baseline
    addToast({ kind: 'success', title: 'Saved' })
  }, [editGraph, addToast])

  // doExitEdit: unconditional exit — no dirty check.
  const doExitEdit = useCallback(() => {
    setEditGraph(null)
    setEditMode(false)
    editBaseRef.current = null
    setShowExitConfirm(false)
  }, [])

  // handleExitEdit: user-facing exit — shows confirm dialog if there are unsaved changes.
  const handleExitEdit = useCallback(() => {
    if (editGraph !== null && editGraph !== editBaseRef.current) {
      setShowExitConfirm(true)
    } else {
      doExitEdit()
    }
  }, [editGraph, doExitEdit])

  const [addNodeTrigger, setAddNodeTrigger] = useState(0)

  const handleAddCharacter = useCallback((character: Character) => {
    if (!editGraph) return
    const updated = { ...editGraph, characters: [...editGraph.characters, character] }
    setEditGraph(updated)
    saveEditGraph(updated)
  }, [editGraph])

  const handleCommitName = useCallback((id: string, name: string) => {
    if (!editGraph) return
    const trimmed = name.trim()
    if (!trimmed) {
      // Empty name — treat as cancel
      const characters = editGraph.characters.filter(c => c.id !== id)
      const next = { ...editGraph, characters }
      setEditGraph(next)
      saveEditGraph(next)
      return
    }
    const characters = editGraph.characters.map(c => c.id === id ? { ...c, name: trimmed } : c)
    const next = { ...editGraph, characters }
    setEditGraph(next)
    saveEditGraph(next)
  }, [editGraph])

  const handleCancelNode = useCallback((id: string) => {
    if (!editGraph) return
    const characters = editGraph.characters.filter(c => c.id !== id)
    const next = { ...editGraph, characters }
    setEditGraph(next)
    saveEditGraph(next)
  }, [editGraph])

  const handleAddRelationship = useCallback((connection: { source: string | null; target: string | null }) => {
    if (!editGraph || !connection.source || !connection.target) return
    const rel: Relationship = {
      id:           crypto.randomUUID(),
      seriesId:     editGraph.series.id,
      fromId:       connection.source,
      toId:         connection.target,
      kind:         'ally',
      label:        'ally',
      directed:     false,
      introducedAt: currentUnit,
      endedAt:      null,
    }
    const next = { ...editGraph, relationships: [...editGraph.relationships, rel] }
    setEditGraph(next)
    saveEditGraph(next)
    handleSelectRelationship(rel)
  }, [editGraph, currentUnit, handleSelectRelationship])

  const handleUpdateRelationship = useCallback((rel: Relationship) => {
    if (!editGraph) return
    const relationships = editGraph.relationships.map(r => r.id === rel.id ? rel : r)
    const next = { ...editGraph, relationships }
    setEditGraph(next)
    saveEditGraph(next)
    setPanelRelationship(rel)
  }, [editGraph])

  const handleDeleteRelationship = useCallback((id: string) => {
    if (!editGraph) return
    const relationships = editGraph.relationships.filter(r => r.id !== id)
    const next = { ...editGraph, relationships }
    setEditGraph(next)
    saveEditGraph(next)
    handleSelectRelationship(null)
  }, [editGraph, handleSelectRelationship])

  const handleEdgesDelete = useCallback((edges: Edge[]) => {
    if (!editGraph) return
    const ids = new Set(edges.map(e => e.id))
    const relationships = editGraph.relationships.filter(r => !ids.has(r.id))
    const next = { ...editGraph, relationships }
    setEditGraph(next)
    saveEditGraph(next)
    if (panelRelationship && ids.has(panelRelationship.id)) handleSelectRelationship(null)
  }, [editGraph, panelRelationship, handleSelectRelationship])

  const handleNodeContextMenu = useCallback((id: string, position: { x: number; y: number }) => {
    setContextMenuNodeId(id)
    setContextMenuPos(position)
  }, [])

  const handleContextMenuClose = useCallback(() => {
    setContextMenuNodeId(null)
    setContextMenuPos(null)
  }, [])

  const handleContextMenuEdit = useCallback(() => {
    if (!contextMenuNodeId || !editGraph) return
    const character = editGraph.characters.find(c => c.id === contextMenuNodeId) ?? null
    handleSelectCharacter(character)
  }, [contextMenuNodeId, editGraph, handleSelectCharacter])

  const handleToggleDeceased = useCallback(() => {
    if (!contextMenuNodeId || !editGraph) return
    const character = editGraph.characters.find(c => c.id === contextMenuNodeId)
    if (!character) return
    const isDeceased = character.diedAt !== null && character.diedAt <= currentUnit
    const updated = { ...character, diedAt: isDeceased ? null : currentUnit }
    const characters = editGraph.characters.map(c => c.id === updated.id ? updated : c)
    const next = { ...editGraph, characters }
    setEditGraph(next)
    saveEditGraph(next)
    if (panelCharacter?.id === updated.id) setPanelCharacter(updated)
  }, [contextMenuNodeId, editGraph, currentUnit, panelCharacter])

  const handleContextMenuDelete = useCallback(() => {
    if (!contextMenuNodeId || !editGraph) return
    const characters = editGraph.characters.filter(c => c.id !== contextMenuNodeId)
    const relationships = editGraph.relationships.filter(
      r => r.fromId !== contextMenuNodeId && r.toId !== contextMenuNodeId,
    )
    const next = { ...editGraph, characters, relationships }
    setEditGraph(next)
    saveEditGraph(next)
    if (panelCharacter?.id === contextMenuNodeId) handleSelectCharacter(null)
    if (panelRelationship && (
      panelRelationship.fromId === contextMenuNodeId ||
      panelRelationship.toId === contextMenuNodeId
    )) handleSelectRelationship(null)
  }, [contextMenuNodeId, editGraph, panelCharacter, panelRelationship, handleSelectCharacter, handleSelectRelationship])

  const handleOpenMetadata = useCallback(() => {
    // Close character/relationship panels so only one panel is visible at a time
    handleSelectCharacter(null)
    handleSelectRelationship(null)
    setMetadataPanelOpen(true)
  }, [handleSelectCharacter, handleSelectRelationship])

  const handleUpdateSeriesMetadata = useCallback((updatedSeries: typeof series) => {
    if (!editGraph) return
    const next = { ...editGraph, series: updatedSeries }
    setEditGraph(next)
    saveEditGraph(next)
  }, [editGraph])

  const handleUpdateCharacter = useCallback((character: Character) => {
    if (!editGraph) return
    const characters = editGraph.characters.map(c => c.id === character.id ? character : c)
    const next = { ...editGraph, characters }
    setEditGraph(next)
    saveEditGraph(next)
    // Keep the panel in sync with the updated data.
    setPanelCharacter(character)
  }, [editGraph])

  // Toggle edit mode: entering uses the full graph (all characters + all
  // relationships, no temporal filtering) as the edit base so no ended
  // relationships are silently dropped. Exiting clears editable state and
  // falls back to the viewer snapshot.
  const handleToggleEditMode = useCallback(() => {
    if (editMode) {
      handleExitEdit()
    } else {
      const base =
        (fullGraphData.status === 'success' ? fullGraphData.snapshot : null) ??
        layoutSnapshot
      if (!base) return
      saveEditGraph(base)
      setEditGraph(base)
      editBaseRef.current = base   // mark clean on entry
      setEditMode(true)
    }
  }, [editMode, handleExitEdit, fullGraphData, layoutSnapshot])

  // 6.4 — inline title editing
  const titleInputRef      = useRef<HTMLInputElement>(null)
  const titleBeforeEditRef = useRef<string>('')

  const handleTitleFocus = useCallback(() => {
    titleBeforeEditRef.current = editGraph?.series.title ?? ''
  }, [editGraph])

  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!editGraph) return
    setEditGraph({ ...editGraph, series: { ...editGraph.series, title: e.target.value } })
  }, [editGraph])

  const handleTitleCommit = useCallback(() => {
    if (!editGraph) return
    const committed = editGraph.series.title.trim() || 'Untitled'
    const updated = { ...editGraph, series: { ...editGraph.series, title: committed } }
    setEditGraph(updated)
    saveEditGraph(updated)
  }, [editGraph])

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      titleInputRef.current?.blur()
    } else if (e.key === 'Escape') {
      if (!editGraph) return
      const reverted = { ...editGraph, series: { ...editGraph.series, title: titleBeforeEditRef.current } }
      setEditGraph(reverted)
      saveEditGraph(reverted)
      titleInputRef.current?.blur()
    }
  }, [editGraph])

  // Only block on loading/error when there is no local or edit preview to fall back to.
  const hasLocalPreview = (editMode && editGraph !== null) || viewerSnapshot !== null || localSnapshot !== null
  if (!hasLocalPreview && graphData.status === 'loading') {
    return (
      <div className="h-screen bg-surface flex items-center justify-center text-white/40 text-sm">
        Loading…
      </div>
    )
  }

  if (!hasLocalPreview && graphData.status === 'error') {
    return (
      <div className="h-screen bg-surface flex items-center justify-center text-red-400 text-sm">
        Failed to load graph. Is the backend running?
      </div>
    )
  }

  // Priority: edit graph → local compiled graph → backend snapshot.
  const snapshot = editableSnapshot ?? viewerSnapshot ?? localSnapshot ?? (graphData as Extract<typeof graphData, { status: 'success' }>).snapshot
  const { series } = snapshot

  return (
    <div className="h-screen bg-surface flex flex-col overflow-hidden text-white">
      <header className="relative flex items-center justify-between px-5 py-3 border-b border-border bg-panel shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-white font-semibold tracking-tight">◈ LitTree</span>
          <span className="text-white/30">·</span>
          {editMode && editGraph != null ? (
            <input
              ref={titleInputRef}
              type="text"
              value={editGraph.series.title}
              placeholder="Untitled"
              onFocus={handleTitleFocus}
              onChange={handleTitleChange}
              onBlur={handleTitleCommit}
              onKeyDown={handleTitleKeyDown}
              className="bg-transparent text-white/70 text-sm outline-none border-b border-transparent focus:border-white/30 placeholder:text-white/30 w-40 transition-colors duration-150"
            />
          ) : (
            <span className="text-white/70 text-sm">{series.title}</span>
          )}
        </div>
        <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none">
          <span className="text-white/70 text-sm font-semibold">{series.unitLabel} {currentUnit}</span>
        </div>
        <Toggle
          checked={showDeceased}
          onChange={setShowDeceased}
          label="Show deceased"
        />
      </header>

      <div className="relative flex flex-1 min-h-0">
        <div className="flex-1 min-w-0">
          <GraphCanvas
            snapshot={snapshot}
            layoutSnapshot={layoutSnapshot ?? snapshot}
            selectedCharacterId={panelCharacter?.id ?? null}
            showDeceased={showDeceased}
            onSelectCharacter={handleSelectCharacter}
            menuOpen={menuOpen}
            onCloseMenu={handleCloseMenu}
            editMode={editMode}
            addNodeTrigger={editMode ? addNodeTrigger : undefined}
            onAddCharacter={editMode ? handleAddCharacter : undefined}
            onCommitName={editMode ? handleCommitName : undefined}
            onCancelNode={editMode ? handleCancelNode : undefined}
            onConnect={editMode ? handleAddRelationship : undefined}
            onSelectRelationship={editMode ? handleSelectRelationship : undefined}
            onEdgesDelete={editMode ? handleEdgesDelete : undefined}
            onNodeContextMenu={editMode ? handleNodeContextMenu : undefined}
          />
        </div>

        {panelCharacter && (
          editMode ? (
            <CharacterEditPanel
              character={panelCharacter}
              series={series}
              isOpen={panelOpen}
              onClose={() => handleSelectCharacter(null)}
              onUpdate={handleUpdateCharacter}
            />
          ) : (
            <CharacterPanel
              character={panelCharacter}
              relationships={snapshot.relationships}
              allCharacters={snapshot.characters}
              series={series}
              atUnit={currentUnit}
              isOpen={panelOpen}
              onClose={() => handleSelectCharacter(null)}
              colours={snapshot.colours}
            />
          )
        )}

        {editMode && editGraph && (
          <GraphMetadataPanel
            series={editGraph.series}
            isOpen={metadataPanelOpen}
            onClose={() => setMetadataPanelOpen(false)}
            onUpdate={handleUpdateSeriesMetadata}
          />
        )}

        {panelRelationship && (
          <RelationshipEditPanel
            relationship={panelRelationship}
            series={series}
            isOpen={relPanelOpen}
            onClose={() => handleSelectRelationship(null)}
            onUpdate={handleUpdateRelationship}
            onDelete={handleDeleteRelationship}
          />
        )}

        {menuMounted && (
          <MenuPanel
            isOpen={menuOpen}
            onClose={handleCloseMenu}
          />
        )}

        <SideToolbar hidden={menuOpen || editorOpen}>
          {editMode ? (
            <>
              <div className="pointer-events-auto">
                <ToolbarButton
                  icon={<SaveIcon />}
                  label="Save"
                  onClick={handleSaveGraph}
                />
              </div>
              <div className="pointer-events-auto">
                <ToolbarButton
                  icon={<ExitEditIcon />}
                  label="Exit Edit Mode"
                  onClick={handleExitEdit}
                />
              </div>
              <div className="pointer-events-auto">
                <ToolbarButton
                  icon={<MetadataIcon />}
                  label="Edit Metadata"
                  onClick={handleOpenMetadata}
                  active={metadataPanelOpen}
                />
              </div>
              <div className="pointer-events-auto">
                <ToolbarButton
                  icon={<NewNodeIcon />}
                  label="New Node"
                  onClick={() => setAddNodeTrigger(t => t + 1)}
                />
              </div>
              <div className="pointer-events-auto">
                <ToolbarButton
                  icon={<NewChapterIcon />}
                  label="Add Chapter"
                  onClick={handleAddChapter}
                />
              </div>
              <div className="pointer-events-auto">
                <ToolbarButton
                  icon={<RemoveChapterIcon />}
                  label="Remove Chapter"
                  onClick={handleRemoveChapter}
                />
              </div>
              <div className="pointer-events-auto">
                <ToolbarButton
                  icon={<EditTimelineIcon />}
                  label="Edit Timeline"
                  onClick={() => addToast({ kind: 'info', title: 'Edit Timeline — coming soon' })}
                />
              </div>
            </>
          ) : (
            <>
              <div className="pointer-events-auto">
                <ToolbarButton
                  icon={<MenuIcon />}
                  label="Open Menu"
                  onClick={handleToggleMenu}
                  active={menuOpen}
                />
              </div>
              <div className="pointer-events-auto">
                <ToolbarButton
                  icon={<EditIcon />}
                  label="Edit Mode"
                  onClick={handleToggleEditMode}
                  active={editMode}
                />
              </div>
              <div className="pointer-events-auto">
                <ToolbarButton
                  icon={<NewGraphIcon />}
                  label="New Graph"
                  onClick={handleNewGraph}
                />
              </div>
              <div className="pointer-events-auto">
                <ToolbarButton
                  icon={<OpenInEditorIcon />}
                  label="Open in Editor"
                  onClick={handleOpenInEditor}
                />
              </div>
              <div className="pointer-events-auto">
                <ToolbarButton
                  icon={<CodeEditorIcon />}
                  label="Code Editor"
                  onClick={handleToggleEditor}
                  active={editorOpen}
                />
              </div>
            </>
          )}
        </SideToolbar>

        {editorMounted && (
          <CodeEditorPanel
            isOpen={editorOpen}
            onClose={handleCloseEditor}
            onCompileAndRender={handleCompileAndRender}
            externalContent={editorContent}
          />
        )}

        {editMode && contextMenuNodeId && contextMenuPos && (() => {
          const character = snapshot.characters.find(c => c.id === contextMenuNodeId)
          if (!character) return null
          return (
            <NodeContextMenu
              character={character}
              position={contextMenuPos}
              currentUnit={currentUnit}
              onEdit={handleContextMenuEdit}
              onToggleDeceased={handleToggleDeceased}
              onDelete={handleContextMenuDelete}
              onClose={handleContextMenuClose}
            />
          )
        })()}

        <NotificationStack />

        {showExitConfirm && (
          <ConfirmDialog
            title="Unsaved changes"
            message="You have unsaved changes. Save before exiting edit mode?"
            confirmLabel="Save & Exit"
            discardLabel="Discard changes"
            cancelLabel="Keep editing"
            onConfirm={() => { handleSaveGraph(); doExitEdit() }}
            onDiscard={doExitEdit}
            onCancel={() => setShowExitConfirm(false)}
          />
        )}

        <div
          className={[
            'absolute bottom-4 left-3 right-3 z-10 transition-opacity duration-[250ms]',
            (panelOpen || menuOpen || editorOpen) ? 'opacity-0 pointer-events-none' : 'opacity-100',
          ].join(' ')}
        >
          <TimelineScrubber
            series={series}
            currentUnit={currentUnit}
            onChange={setCurrentUnit}
          />
        </div>
      </div>
    </div>
  )
}

function NewGraphIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <rect x="1.5" y="2" width="9" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M11 6.5h2.5M12.25 5.25v2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M4 5.5h5M4 7.5h5M4 9.5h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path d="M10.5 2.5l2 2L5 12H3v-2l7.5-7.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path d="M2 4h11M2 7.5h11M2 11h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function OpenInEditorIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.5 5.5h6M4.5 7.5h6M4.5 9.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function CodeEditorIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path d="M4.5 3.5L1 7.5l3.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.5 3.5L14 7.5l-3.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 2l-4 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function SaveIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <rect x="4.5" y="2" width="6" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="3.5" y="8" width="8" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function ExitEditIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path d="M2.5 7.5h8M7 4l3.5 3.5L7 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 2.5H3a1 1 0 00-1 1v8a1 1 0 001 1h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function NewNodeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <circle cx="7.5" cy="7.5" r="3.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7.5 2V1M7.5 14v-1M2 7.5H1M14 7.5h-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M11 4.5h2.5M12.25 3.25v2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function MetadataIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <circle cx="7.5" cy="7.5" r="5.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7.5 5v1M7.5 7v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function RemoveChapterIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path d="M3 2.5h6.5a1 1 0 011 1V11a1 1 0 01-1 1H3a1 1 0 01-1-1V3.5a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 6h4M5 8h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M11 3h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function NewChapterIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path d="M3 2.5h6.5a1 1 0 011 1V11a1 1 0 01-1 1H3a1 1 0 01-1-1V3.5a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 6h4M5 8h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M11 3h2.5M12.25 1.75v2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function EditTimelineIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path d="M1.5 4.5h12M1.5 7.5h12M1.5 10.5h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <rect x="3" y="3.5" width="3" height="2" rx="0.5" fill="currentColor" />
      <rect x="7" y="6.5" width="4" height="2" rx="0.5" fill="currentColor" />
      <rect x="5" y="9.5" width="2" height="2" rx="0.5" fill="currentColor" />
    </svg>
  )
}
