import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Series } from '../types/domain'

type Props = {
  series: Series
  currentUnit: number
  onChange: (unit: number) => void
}

const DOT_SIZE          = 6
const CURSOR_SIZE_REST  = 14
const CURSOR_SIZE_HOVER = 20   // larger, invites interaction
const CURSOR_SIZE_DRAG  = 16   // smaller than hover — snaps into active feel
const HOVER_DELAY_MS    = 300

const CURSOR_COLOR_REST  = '#4ade80'  // saturated green
const CURSOR_COLOR_HOVER = '#7aad88'  // desaturated — softer, not yet grabbed
const CURSOR_COLOR_DRAG  = '#4ade80'  // back to saturated — committed, active

// Distance from wrapper left/right edge to the track div edge.
// Pill px-2 (8px) + button w-10 (40px) + gap-5 (20px) = 68px per side.
const TRACK_INSET = 68

const TimelineScrubber = memo(({ series, currentUnit, onChange }: Props) => {
  const trackRef      = useRef<HTMLDivElement>(null)
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear pending timers on unmount to prevent setState calls after unmount.
  useEffect(() => {
    return () => {
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current)
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    }
  }, [])

  const [rawProgress, setRawProgress]           = useState<number | null>(null)
  const [pressPreviewUnit, setPressPreviewUnit] = useState<number | null>(null)
  // hoverUnit: chapter under cursor on the track region (null when over buttons).
  // overButton: cursor is inside the pill but over a prev/next button, not the track.
  // hoverReady: true after HOVER_DELAY_MS — gates the label so it only appears on intentional hover.
  const [hoverUnit,   setHoverUnit]   = useState<number | null>(null)
  const [overButton,  setOverButton]  = useState(false)
  const [hoverReady,  setHoverReady]  = useState(false)

  const dragging        = rawProgress !== null
  const totalUnits      = series.totalUnits
  const snappedProgress = (currentUnit - 1) / Math.max(totalUnits - 1, 1)
  const cursorProgress  = rawProgress ?? snappedProgress

  const previewUnit = dragging
    ? Math.round(1 + rawProgress * (totalUnits - 1))
    : currentUnit

  // Label is active for drag/press immediately; for hover only after the delay.
  // overButton counts as "hovering" for visibility but activeUnit falls through to currentUnit.
  const showLabel = dragging || pressPreviewUnit !== null || ((hoverUnit !== null || overButton) && hoverReady)

  // The unit and progress the label should logically track right now.
  const activeUnit     = dragging ? previewUnit : (pressPreviewUnit ?? hoverUnit ?? currentUnit)
  const activeProgress = dragging
    ? cursorProgress
    : (activeUnit - 1) / Math.max(totalUnits - 1, 1)

  // Freeze the last rendered position so the label fades out in-place rather
  // than sliding back toward the current chapter when hover ends.
  const frozenUnitRef     = useRef(currentUnit)
  const frozenProgressRef = useRef(snappedProgress)
  if (showLabel) {
    frozenUnitRef.current     = activeUnit
    frozenProgressRef.current = activeProgress
  }

  const displayUnit     = showLabel ? activeUnit     : frozenUnitRef.current
  const displayProgress = showLabel ? activeProgress : frozenProgressRef.current

  // Enable left sliding only when the label was visible on the *previous committed*
  // render AND is still visible now. useLayoutEffect (not a render-phase mutation)
  // ensures the ref reflects the last committed state, which is immune to React's
  // StrictMode double-invoke and concurrent re-renders.
  const wasShowingRef  = useRef(false)
  const alreadyShowing = wasShowingRef.current && showLabel
  useLayoutEffect(() => { wasShowingRef.current = showLabel })


  const labelLeft = `calc(${TRACK_INSET}px + ${(displayProgress * 100).toFixed(3)}% - ${(displayProgress * TRACK_INSET * 2).toFixed(3)}px)`

  const progressFromClientX = useCallback((clientX: number): number => {
    const track = trackRef.current
    if (!track) return snappedProgress
    const { left, width } = track.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - left) / width))
  }, [snappedProgress])

  const unitFromClientX = useCallback((clientX: number): number => {
    const track = trackRef.current
    if (!track) return currentUnit
    const { left, width } = track.getBoundingClientRect()
    const progress = Math.max(0, Math.min(1, (clientX - left) / width))
    return Math.round(1 + progress * (totalUnits - 1))
  }, [currentUnit, totalUnits])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Cancel the hover-ready timer — drag takes over, no need to show the
    // delayed label via the hover path.
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setHoverReady(false)
    e.currentTarget.setPointerCapture(e.pointerId)
    setRawProgress(progressFromClientX(e.clientX))
  }, [progressFromClientX])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    setRawProgress(progressFromClientX(e.clientX))
  }, [progressFromClientX])

  const handlePointerUp = useCallback(() => {
    if (rawProgress !== null) {
      onChange(Math.round(1 + rawProgress * (totalUnits - 1)))
    }
    setRawProgress(null)
  }, [rawProgress, totalUnits, onChange])

  const handleTrackMouseEnter = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    const track = trackRef.current
    if (track) {
      const { left, right } = track.getBoundingClientRect()
      if (e.clientX < left || e.clientX > right) {
        setHoverUnit(null)
        setOverButton(true)
      } else {
        setHoverUnit(unitFromClientX(e.clientX))
        setOverButton(false)
      }
    }
    hoverTimerRef.current = setTimeout(() => setHoverReady(true), HOVER_DELAY_MS)
  }, [unitFromClientX])

  const handleTrackMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const track = trackRef.current
    if (!track) return
    const { left, right } = track.getBoundingClientRect()
    // Outside the track bounds — cursor is over a button. Don't store currentUnit in state;
    // activeUnit will fall through to the live currentUnit prop instead, avoiding stale reads.
    if (e.clientX < left || e.clientX > right) {
      setHoverUnit(null)
      setOverButton(true)
    } else {
      setHoverUnit(unitFromClientX(e.clientX))
      setOverButton(false)
    }
  }, [unitFromClientX])

  const handleTrackMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    setHoverUnit(null)
    setOverButton(false)
    setHoverReady(false)
  }, [])

  const showPressPreview = useCallback((unit: number) => {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current)
    setPressPreviewUnit(unit)
    pressTimerRef.current = setTimeout(() => setPressPreviewUnit(null), 700)
  }, [])

  const handlePrev = useCallback(() => {
    const next = Math.max(1, currentUnit - 1)
    onChange(next)
    showPressPreview(next)
  }, [currentUnit, onChange, showPressPreview])

  const handleNext = useCallback(() => {
    const next = Math.min(totalUnits, currentUnit + 1)
    onChange(next)
    showPressPreview(next)
  }, [currentUnit, totalUnits, onChange, showPressPreview])

  const trackHovered = hoverUnit !== null || overButton
  const cursorSize  = dragging ? CURSOR_SIZE_DRAG : trackHovered ? CURSOR_SIZE_HOVER : CURSOR_SIZE_REST
  const cursorColor = dragging ? CURSOR_COLOR_DRAG : trackHovered ? CURSOR_COLOR_HOVER : CURSOR_COLOR_REST

  return (
    <div className="relative select-none">

      {/* Floating label */}
      <div
        className="absolute -translate-x-1/2 pointer-events-none"
        style={{
          left:       labelLeft,
          bottom:     'calc(100% + 8px)',
          opacity:    showLabel ? 1 : 0,
          transition: alreadyShowing && !dragging
            ? 'left 180ms ease, opacity 150ms ease'
            : 'opacity 150ms ease',
        }}
      >
        <div className="w-9 h-9 flex items-center justify-center bg-panel border border-border rounded-2xl shadow-xl text-sm font-semibold text-white/80">
          {displayUnit}
        </div>
      </div>

      {/* Pill — entire surface is draggable; buttons stop propagation to remain step-only */}
      <div
        className="flex items-center gap-5 bg-panel border border-border rounded-full shadow-xl px-2 py-1.5 cursor-pointer"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onMouseEnter={handleTrackMouseEnter}
        onMouseMove={handleTrackMouseMove}
        onMouseLeave={handleTrackMouseLeave}
      >

        <button
          onClick={handlePrev}
          onPointerDown={e => e.stopPropagation()}
          disabled={currentUnit === 1}
          aria-label={`Previous ${series.unitLabel}`}
          className="w-10 h-10 flex items-center justify-center rounded-full text-white/40 hover:text-white hover:bg-white/10 active:bg-white/20 disabled:text-white/20 disabled:hover:bg-transparent transition-colors shrink-0 cursor-default"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M9 11L5 7L9 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div
          ref={trackRef}
          className="flex-1 relative self-stretch"
        >
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-white/10 rounded-full" />

          {Array.from({ length: totalUnits }, (_, i) => {
            const ch  = i + 1
            const pct = totalUnits > 1 ? (i / (totalUnits - 1)) * 100 : 50
            if (ch === previewUnit) return null
            return (
              <div
                key={ch}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
                style={{
                  left:            `${pct}%`,
                  width:           DOT_SIZE,
                  height:          DOT_SIZE,
                  backgroundColor: 'rgba(255, 255, 255, 0.18)',
                }}
              />
            )
          })}

          <div
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
            style={{
              left:            `${cursorProgress * 100}%`,
              width:           cursorSize,
              height:          cursorSize,
              backgroundColor: cursorColor,
              boxShadow: dragging
                ? '0 0 0 4px rgba(74, 222, 128, 0.3)'
                : trackHovered
                  ? '0 0 0 5px rgba(122, 173, 136, 0.25)'
                  : '0 0 0 3px rgba(74, 222, 128, 0.15)',
              transition: dragging
                ? 'width 120ms ease, height 120ms ease, background-color 120ms ease, box-shadow 120ms ease'
                : 'left 180ms ease, width 120ms ease, height 120ms ease, background-color 120ms ease, box-shadow 120ms ease',
            }}
          />
        </div>

        <button
          onClick={handleNext}
          onPointerDown={e => e.stopPropagation()}
          disabled={currentUnit === totalUnits}
          aria-label={`Next ${series.unitLabel}`}
          className="w-10 h-10 flex items-center justify-center rounded-full text-white/40 hover:text-white hover:bg-white/10 active:bg-white/20 disabled:text-white/20 disabled:hover:bg-transparent transition-colors shrink-0 cursor-default"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M5 3L9 7L5 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

      </div>
    </div>
  )
})

TimelineScrubber.displayName = 'TimelineScrubber'
export default TimelineScrubber
