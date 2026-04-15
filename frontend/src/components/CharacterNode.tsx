import { memo, useEffect, useRef, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'

// All four sides declared as both source and target so React Flow's connection
// system works from any direction. The edge component ignores these positions
// and computes its own attachment points via useInternalNode.
const HANDLES = [Position.Top, Position.Right, Position.Bottom, Position.Left]
import { getCharacterState, getInitials, type Character } from '../types/domain'

export type CharacterNodeData = {
  character: Character
  atUnit: number
  isSelected: boolean
  editMode?: boolean
  isNaming?: boolean
  onCommitName?: (id: string, name: string) => void
  onCancelNode?: (id: string) => void
}

const CharacterNode = memo(({ data }: NodeProps) => {
  const { character, atUnit, isSelected, editMode, isNaming, onCommitName, onCancelNode } = data as CharacterNodeData
  const state = getCharacterState(character, atUnit)
  const deceased = state.status === 'deceased'

  // Fade in on mount — start transparent, transition to full opacity
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(t)
  }, [])

  // Inline naming state — only active when isNaming is true
  const [nameDraft, setNameDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const escapedRef = useRef(false)

  useEffect(() => {
    if (isNaming) {
      setNameDraft('')
      escapedRef.current = false
    }
  }, [isNaming])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Prevent React Flow from intercepting keyboard events while typing.
    e.stopPropagation()
    if (e.key === 'Enter') {
      inputRef.current?.blur()
    } else if (e.key === 'Escape') {
      escapedRef.current = true
      onCancelNode?.(character.id)
    }
  }

  const handleBlur = () => {
    if (escapedRef.current) return
    onCommitName?.(character.id, nameDraft)
  }

  const handleClass = editMode
    ? '!w-3 !h-3 opacity-0 group-hover:opacity-100 !bg-white/20 !border !border-white/40 !rounded-full transition-opacity duration-150'
    : 'opacity-0 !w-0 !h-0 !min-w-0 !min-h-0 !p-0'

  return (
    <div
      style={{ opacity: mounted ? 1 : 0, transition: 'opacity 0.35s ease' }}
      className={[
        'group flex flex-col items-center gap-1 px-3 py-2 rounded-xl border select-none cursor-pointer',
        'bg-panel text-white min-w-[80px]',
        deceased   ? 'opacity-40 border-border'        : 'border-border',
        isNaming   ? 'ring-2 ring-white/40 border-white/40' : '',
        isSelected && !isNaming ? 'ring-2 ring-white border-white'  : '',
        !isSelected && !isNaming ? 'hover:border-white/40' : '',
      ].join(' ')}
    >
      {HANDLES.flatMap(pos => [
        <Handle key={`s-${pos}`} type="source" position={pos} id={`s-${pos}`} isConnectable={editMode} className={handleClass} />,
        <Handle key={`t-${pos}`} type="target" position={pos} id={`t-${pos}`} isConnectable={editMode} className={handleClass} />,
      ])}

      <div className={[
        'w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold',
        deceased ? 'bg-border text-white/40' : 'bg-white/10 text-white',
      ].join(' ')}>
        {character.imageUrl
          ? <img src={character.imageUrl} alt={character.name} className="w-full h-full rounded-full object-cover" />
          : getInitials(isNaming ? nameDraft : character.name)
        }
      </div>

      {isNaming ? (
        <input
          ref={inputRef}
          type="text"
          value={nameDraft}
          onChange={e => setNameDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          placeholder="Name…"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          className="nodrag nopan bg-transparent text-xs font-medium text-white text-center w-24 outline-none border-b border-white/30 focus:border-white/60 placeholder:text-white/30 px-1"
        />
      ) : (
        <span className={[
          'text-xs font-medium text-center leading-tight max-w-[100px] truncate',
          deceased ? 'text-white/40' : '',
        ].join(' ')}>
          {character.name}
        </span>
      )}

      {deceased && state.status === 'deceased' && (
        <span className="text-[10px] text-white/30">† Ch {state.diedAt}</span>
      )}
    </div>
  )
})

CharacterNode.displayName = 'CharacterNode'
export default CharacterNode
