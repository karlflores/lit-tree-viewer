import { useCallback, useEffect, useRef, useState } from 'react'
import type { Character } from './types/domain'
import { useGraphData } from './hooks/useGraphData'
import GraphCanvas from './components/GraphCanvas'
import TimelineScrubber from './components/TimelineScrubber'
import CharacterPanel from './components/CharacterPanel'
import MenuPanel from './components/MenuPanel'
import Toggle from './components/Toggle'

const SERIES_ID = '00000000-0000-0000-0000-000000000001'
const PANEL_CLOSE_MS = 250

export default function App() {
  const [currentUnit, setCurrentUnit] = useState(1)
  const [showDeceased, setShowDeceased] = useState(true)

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

  useEffect(() => {
    return () => {
      if (closeTimerRef.current)      clearTimeout(closeTimerRef.current)
      if (openRafRef.current !== null) cancelAnimationFrame(openRafRef.current)
      if (menuCloseTimerRef.current)  clearTimeout(menuCloseTimerRef.current)
      if (menuOpenRafRef.current !== null) cancelAnimationFrame(menuOpenRafRef.current)
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

  const graphData = useGraphData(SERIES_ID, currentUnit)

  if (graphData.status === 'loading') {
    return (
      <div className="h-screen bg-surface flex items-center justify-center text-white/40 text-sm">
        Loading…
      </div>
    )
  }

  if (graphData.status === 'error') {
    return (
      <div className="h-screen bg-surface flex items-center justify-center text-red-400 text-sm">
        Failed to load graph. Is the backend running?
      </div>
    )
  }

  const { snapshot } = graphData
  const { series }   = snapshot

  return (
    <div className="h-screen bg-surface flex flex-col overflow-hidden text-white">
      <header className="relative flex items-center justify-between px-5 py-3 border-b border-border bg-panel shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-white font-semibold tracking-tight">◈ LitTree</span>
          <span className="text-white/30">·</span>
          <span className="text-white/70 text-sm">{series.title}</span>
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
            selectedCharacterId={panelCharacter?.id ?? null}
            showDeceased={showDeceased}
            onSelectCharacter={handleSelectCharacter}
            menuOpen={menuOpen}
            onToggleMenu={handleToggleMenu}
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
          />
        )}

        {menuMounted && (
          <MenuPanel
            isOpen={menuOpen}
            onClose={handleCloseMenu}
          />
        )}

        <div
          className={[
            'absolute bottom-4 left-3 right-3 z-10 transition-opacity duration-[250ms]',
            (panelOpen || menuOpen) ? 'opacity-0 pointer-events-none' : 'opacity-100',
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
