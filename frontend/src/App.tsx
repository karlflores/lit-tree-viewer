import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Character, GraphSnapshot } from './types/domain'
import { useGraphData } from './hooks/useGraphData'
import { useFullGraph } from './hooks/useFullGraph'
import { useCompiledGraph } from './hooks/useCompiledGraph'
import { compiledToSnapshot } from './lib/ltgCompiler'
import type { CompileSuccess } from './lib/ltgLspClient'
import { emitLtg } from './lib/ltgEmitter'
import { editableToSnapshot } from './lib/editableToSnapshot'
import { createEmptyGraph, saveEditGraph, loadEditGraph } from './lib/editGraphSession'
import { useNotificationStore } from './lib/notificationStore'
import GraphCanvas from './components/GraphCanvas'
import TimelineScrubber from './components/TimelineScrubber'
import CharacterPanel from './components/CharacterPanel'
import MenuPanel from './components/MenuPanel'
import CodeEditorPanel from './components/CodeEditorPanel'
import SideToolbar from './components/SideToolbar'
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

  const addToast = useNotificationStore(s => s.addToast)

  // Resume any in-progress edit session from sessionStorage on mount.
  useEffect(() => {
    const saved = loadEditGraph()
    if (saved) {
      setEditGraph(saved)
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
    // Cancel any in-flight open RAF so a close that arrives before the next
    // frame doesn't get overridden by a stale setPanelOpen(true).
    if (openRafRef.current !== null) {
      cancelAnimationFrame(openRafRef.current)
      openRafRef.current = null
    }
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)

    if (character) {
      setPanelCharacter(character)
      // Defer open so the panel mounts at translate-x-full before transitioning in.
      openRafRef.current = requestAnimationFrame(() => {
        openRafRef.current = null
        setPanelOpen(true)
      })
    } else {
      setPanelOpen(false)
      closeTimerRef.current = setTimeout(() => setPanelCharacter(null), PANEL_CLOSE_MS)
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

  const layoutSnapshot =
    fullEditableSnapshot ??
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

  const handleNewGraph = useCallback(() => {
    const graph = createEmptyGraph()
    saveEditGraph(graph)
    setEditGraph(graph)
    setEditMode(true)
    setCurrentUnit(1)
  }, [])

  const handleSaveGraph = useCallback(() => {
    if (!editGraph) return
    saveEditGraph(editGraph)
    addToast({ kind: 'success', title: 'Saved' })
  }, [editGraph, addToast])

  const handleExitEdit = useCallback(() => {
    setEditGraph(null)
    setEditMode(false)
  }, [])

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
  const hasLocalPreview = (editMode && editGraph !== null) || localSnapshot !== null
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
  const snapshot = editableSnapshot ?? localSnapshot ?? (graphData as Extract<typeof graphData, { status: 'success' }>).snapshot
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
          />
        </div>

        {panelCharacter && (
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
        )}

        {menuMounted && (
          <MenuPanel
            isOpen={menuOpen}
            onClose={handleCloseMenu}
          />
        )}

        <SideToolbar hidden={menuOpen || editorOpen}>
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
        </SideToolbar>

        {editorMounted && (
          <CodeEditorPanel
            isOpen={editorOpen}
            onClose={handleCloseEditor}
            onCompileAndRender={handleCompileAndRender}
            externalContent={editorContent}
          />
        )}

        <NotificationStack />

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
