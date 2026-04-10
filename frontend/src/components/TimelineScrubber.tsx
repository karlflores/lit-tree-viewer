import { memo, useCallback, useRef, useState } from 'react'
import type { Series } from '../types/domain'

type Props = {
  series: Series
  currentUnit: number
  onChange: (unit: number) => void
}

const DOT_SIZE         = 6
const CURSOR_SIZE_REST = 14
const CURSOR_SIZE_DRAG = 22

const CURSOR_COLOR_REST = '#4ade80' // green-400  — snapped, at rest
const CURSOR_COLOR_DRAG = '#6b8f72' // grey-green — dragging / desaturated

const TimelineScrubber = memo(({ series, currentUnit, onChange }: Props) => {
  const trackRef = useRef<HTMLDivElement>(null)

  // rawProgress: exact pointer position (0–1) while dragging, null at rest.
  // Keeping it separate from currentUnit lets the cursor move fluidly without
  // committing a chapter change on every frame.
  const [rawProgress, setRawProgress] = useState<number | null>(null)
  const dragging = rawProgress !== null

  const totalUnits     = series.totalUnits
  const snappedProgress = (currentUnit - 1) / Math.max(totalUnits - 1, 1)

  // Visual cursor position: raw (fluid) while dragging, snapped at rest
  const cursorProgress = rawProgress ?? snappedProgress

  // The chapter the cursor will commit to on release — shown in the label
  // and used to hide the dot the cursor is targeting
  const previewUnit = dragging
    ? Math.round(1 + rawProgress * (totalUnits - 1))
    : currentUnit

  const progressFromClientX = useCallback((clientX: number): number => {
    const track = trackRef.current
    if (!track) return snappedProgress
    const { left, width } = track.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - left) / width))
  }, [snappedProgress])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setRawProgress(progressFromClientX(e.clientX))
  }, [progressFromClientX])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    setRawProgress(progressFromClientX(e.clientX))
  }, [progressFromClientX])

  const handlePointerUp = useCallback(() => {
    if (rawProgress !== null) {
      // Snap to nearest chapter and commit
      onChange(Math.round(1 + rawProgress * (totalUnits - 1)))
    }
    setRawProgress(null)
  }, [rawProgress, totalUnits, onChange])

  const cursorSize = dragging ? CURSOR_SIZE_DRAG : CURSOR_SIZE_REST

  return (
    <div className="bg-panel border-t border-border px-8 pt-4 pb-6 select-none">
      {/* Floating label — tracks raw position while dragging, shows snap target.
           At rest: bare number in small text. While dragging: pill with larger number. */}
      <div className="relative h-6 mb-3">
        <div
          className="absolute -translate-x-1/2"
          style={{
            left: `${cursorProgress * 100}%`,
            transition: dragging ? 'none' : 'left 180ms ease',
          }}
        >
          <span
            style={{
              display:         'inline-block',
              fontSize:        dragging ? 15 : 13,
              fontWeight:      600,
              color:           dragging ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.60)',
              backgroundColor: dragging ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0)',
              borderRadius:    6,
              padding:         dragging ? '2px 10px' : '0',
              whiteSpace:      'nowrap',
              lineHeight:      1.4,
              transition: [
                'font-size 120ms ease',
                'color 120ms ease',
                'background-color 150ms ease',
                'padding 150ms ease',
              ].join(', '),
            }}
          >
            {previewUnit}
          </span>
        </div>
      </div>

      {/* Interaction surface */}
      <div
        ref={trackRef}
        className="relative cursor-pointer"
        style={{ height: 28 }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Track line */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-white/10 rounded-full" />

        {/* Chapter dots — hide the one the cursor is targeting */}
        {Array.from({ length: totalUnits }, (_, i) => {
          const ch  = i + 1
          const pct = (i / (totalUnits - 1)) * 100
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

        {/* Cursor */}
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
          style={{
            left:            `${cursorProgress * 100}%`,
            width:           cursorSize,
            height:          cursorSize,
            backgroundColor: dragging ? CURSOR_COLOR_DRAG : CURSOR_COLOR_REST,
            boxShadow:       dragging
              ? '0 0 0 4px rgba(107, 143, 114, 0.2)'
              : '0 0 0 3px rgba(74, 222, 128, 0.15)',
            // No left transition during drag — follow the pointer exactly.
            // Re-enable on release so the snap-to-chapter animates smoothly.
            transition: dragging
              ? 'width 120ms ease, height 120ms ease, background-color 120ms ease, box-shadow 120ms ease'
              : 'left 180ms ease, width 120ms ease, height 120ms ease, background-color 120ms ease, box-shadow 120ms ease',
          }}
        />
      </div>
    </div>
  )
})

TimelineScrubber.displayName = 'TimelineScrubber'
export default TimelineScrubber
