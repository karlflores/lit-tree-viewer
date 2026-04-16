import { memo, useEffect, useRef, useState } from 'react'
import type { Character } from '../types/domain'

type Props = {
  character: Character
  position: { x: number; y: number }
  currentUnit: number
  onEdit: () => void
  onToggleDeceased: () => void
  onDelete: () => void
  onClose: () => void
}

const NodeContextMenu = memo(({ character, position, currentUnit, onEdit, onToggleDeceased, onDelete, onClose }: Props) => {
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on outside mousedown. Use capture phase so React Flow's
  // stopPropagation on the canvas doesn't swallow the event before we see it.
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleMouseDown, true)
    return () => document.removeEventListener('mousedown', handleMouseDown, true)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Two-click delete confirmation
  const [confirmDelete, setConfirmDelete] = useState(false)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
  }, [])

  const handleDeleteClick = () => {
    if (confirmDelete) {
      onDelete()
    } else {
      setConfirmDelete(true)
      confirmTimerRef.current = setTimeout(() => setConfirmDelete(false), 2500)
    }
  }

  const isDeceased = character.diedAt !== null && character.diedAt <= currentUnit

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{ left: position.x, top: position.y }}
      className="fixed z-50 w-44 bg-panel border border-border rounded-xl shadow-xl overflow-hidden py-1"
    >
      <MenuItem icon={<EditIcon />} onClick={() => { onEdit(); onClose() }}>
        Edit character
      </MenuItem>

      <MenuItem icon={<DeceasedIcon />} onClick={() => { onToggleDeceased(); onClose() }}>
        {isDeceased ? 'Mark as alive' : 'Mark as deceased'}
      </MenuItem>

      <div className="my-1 border-t border-border" />

      <MenuItem
        icon={<DeleteIcon />}
        onClick={handleDeleteClick}
        danger
      >
        {confirmDelete ? 'Confirm delete?' : 'Delete character'}
      </MenuItem>
    </div>
  )
})

NodeContextMenu.displayName = 'NodeContextMenu'
export default NodeContextMenu

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type MenuItemProps = {
  icon: React.ReactNode
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}

function MenuItem({ icon, onClick, danger = false, children }: MenuItemProps) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={[
        'flex items-center gap-2.5 w-full px-3 py-2 text-xs text-left transition-colors',
        danger
          ? 'text-red-400/70 hover:text-red-400 hover:bg-red-400/8'
          : 'text-white/60 hover:text-white hover:bg-white/5',
      ].join(' ')}
    >
      <span className="shrink-0 text-current">{icon}</span>
      {children}
    </button>
  )
}

function EditIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M8.5 1.5l2 2L3.5 11H1.5v-2L8.5 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DeceasedIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="6" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.5 10.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M6 10.5V8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function DeleteIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2 3h8M5 3V2h2v1M4.5 3v6.5M7.5 3v6.5M3 3l.5 7.5h5L9 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
