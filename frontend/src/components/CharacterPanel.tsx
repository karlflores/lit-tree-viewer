import { memo } from 'react'
import { getCharacterState, getInitials, type Character, type Relationship, type Series } from '../types/domain'
import { getEdgeStyle } from '../lib/edgeStyles'

type Props = {
  character: Character
  relationships: readonly Relationship[]
  allCharacters: readonly Character[]
  series: Series
  atUnit: number
  isOpen: boolean
  onClose: () => void
}

const CharacterPanel = memo(({ character, relationships, allCharacters, series, atUnit, isOpen, onClose }: Props) => {
  const state = getCharacterState(character, atUnit)
  const deceased = state.status === 'deceased'
  const charById = new Map(allCharacters.map(c => [c.id, c]))

  const relevant = relationships.filter(
    r => r.fromId === character.id || r.toId === character.id,
  )

  return (
    <aside
      className={[
        'absolute right-3 top-4 bottom-4 w-72 bg-panel border border-border rounded-3xl shadow-xl flex flex-col overflow-hidden',
        'transition-transform duration-[250ms] ease-in-out',
        isOpen ? 'translate-x-0' : 'translate-x-[calc(100%+1rem)]',
      ].join(' ')}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <span className="text-sm font-semibold text-white truncate">{character.name}</span>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white text-lg leading-none ml-2"
          aria-label="Close panel"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-col flex-1 overflow-y-auto">
      <div className="flex flex-col items-center gap-2 pt-6 pb-4 px-4">
        <div className={[
          'w-16 h-16 rounded-full flex items-center justify-center text-xl font-semibold',
          deceased ? 'bg-border text-white/30' : 'bg-white/10 text-white',
        ].join(' ')}>
          {character.imageUrl
            ? <img src={character.imageUrl} alt={character.name} className="w-full h-full rounded-full object-cover" />
            : getInitials(character.name)
          }
        </div>
        {character.aliases.length > 0 && (
          <p className="text-[11px] text-white/40 text-center">{character.aliases.join(' · ')}</p>
        )}
        {deceased && state.status === 'deceased' && (
          <span className="text-xs text-white/30">† {series.unitLabel} {state.diedAt}</span>
        )}
      </div>

      {character.description && (
        <p className="px-4 pb-4 text-xs text-white/60 leading-relaxed">{character.description}</p>
      )}

      <div className="px-4 pb-4 text-xs text-white/40">
        First appears: {series.unitLabel} {character.introducedAt}
      </div>

      {relevant.length > 0 && (
        <div className="px-4 pb-4 border-t border-border pt-3">
          <p className="text-[10px] uppercase tracking-wider text-white/30 mb-2">
            Relationships at {series.unitLabel} {atUnit}
          </p>
          <ul className="flex flex-col gap-1.5">
            {relevant.map(r => {
              const otherId = r.fromId === character.id ? r.toId : r.fromId
              const other = charById.get(otherId)
              const style = getEdgeStyle(r.kind, r.label)
              const arrow = r.directed
                ? r.fromId === character.id ? '→' : '←'
                : '↔'
              return (
                <li key={r.id} className="flex items-center gap-2 text-xs">
                  <span className="w-4 text-center" style={{ color: style.color }}>{arrow}</span>
                  <span className="text-white/70">{other?.name ?? 'Unknown'}</span>
                  {r.label && (
                    <span className="text-white/30 ml-auto text-[10px]">{r.label}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      </div>
    </aside>
  )
})

CharacterPanel.displayName = 'CharacterPanel'
export default CharacterPanel
