import { memo, useRef, useState } from 'react'

const EXPAND_DELAY_MS = 500

type Props = {
  icon: React.ReactNode
  label: string
  onClick: () => void
  active?: boolean
}

const ToolbarButton = memo(({ icon, label, onClick, active = false }: Props) => {
  const [expanded, setExpanded] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMouseEnter = () => {
    timerRef.current = setTimeout(() => setExpanded(true), EXPAND_DELAY_MS)
  }

  const handleMouseLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setExpanded(false)
  }

  return (
    <button
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ maxWidth: expanded ? '200px' : '40px' }}
      className={[
        'h-10 flex items-center overflow-hidden',
        'border rounded-full shadow-lg',
        'transition-[max-width,color,background-color,border-color] duration-200 ease-out',
        'cursor-pointer select-none',
        active
          ? 'bg-white/10 border-white/20 text-white'
          : 'bg-panel border-border text-white/50 hover:text-white hover:bg-white/5 hover:border-white/15',
      ].join(' ')}
    >
      {/* Icon — fixed 40×40 so the circle never shrinks */}
      <span className="w-10 h-10 flex items-center justify-center shrink-0">
        {icon}
      </span>
      {/* Label — always rendered; the overflow:hidden on the button clips it */}
      <span className="pr-3 text-[11px] font-medium whitespace-nowrap leading-none">
        {label}
      </span>
    </button>
  )
})

ToolbarButton.displayName = 'ToolbarButton'
export default ToolbarButton
