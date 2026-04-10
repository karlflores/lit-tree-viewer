import { memo, useEffect, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { getCharacterState, getInitials, type Character } from '../types/domain'

export type CharacterNodeData = {
  character: Character
  atUnit: number
  isSelected: boolean
}

const CharacterNode = memo(({ data }: NodeProps) => {
  const { character, atUnit, isSelected } = data as CharacterNodeData
  const state = getCharacterState(character, atUnit)
  const deceased = state.status === 'deceased'

  // Fade in on mount — start transparent, transition to full opacity
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(t)
  }, [])

  return (
    <div
      style={{ opacity: mounted ? 1 : 0, transition: 'opacity 0.35s ease' }}
      className={[
        'flex flex-col items-center gap-1 px-3 py-2 rounded-xl border select-none cursor-pointer',
        'bg-panel text-white min-w-[80px]',
        deceased   ? 'opacity-40 border-border'        : 'border-border',
        isSelected ? 'ring-2 ring-white border-white'  : 'hover:border-white/40',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Top}    className="opacity-0" />
      <Handle type="source" position={Position.Bottom} className="opacity-0" />

      <div className={[
        'w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold',
        deceased ? 'bg-border text-white/40' : 'bg-white/10 text-white',
      ].join(' ')}>
        {character.imageUrl
          ? <img src={character.imageUrl} alt={character.name} className="w-full h-full rounded-full object-cover" />
          : getInitials(character.name)
        }
      </div>

      <span className={[
        'text-xs font-medium text-center leading-tight max-w-[100px] truncate',
        deceased ? 'text-white/40' : '',
      ].join(' ')}>
        {character.name}
      </span>

      {deceased && state.status === 'deceased' && (
        <span className="text-[10px] text-white/30">† Ch {state.diedAt}</span>
      )}
    </div>
  )
})

CharacterNode.displayName = 'CharacterNode'
export default CharacterNode
