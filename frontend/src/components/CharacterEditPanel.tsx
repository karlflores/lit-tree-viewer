import { memo, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { Character, Series } from '../types/domain'

type Props = {
  character: Character
  series: Series
  isOpen: boolean
  onClose: () => void
  onUpdate: (character: Character) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const inputClass =
  'w-full bg-white/5 border border-border rounded-lg px-3 py-1.5 text-xs text-white ' +
  'placeholder:text-white/25 outline-none focus:border-white/30 transition-colors'

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] uppercase tracking-wider text-white/40 flex items-center gap-1.5">
        {label}
        {hint && <span className="normal-case tracking-normal text-white/25">({hint})</span>}
        {required && <span className="text-white/30">*</span>}
      </label>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CharacterEditPanel
// ---------------------------------------------------------------------------

const CharacterEditPanel = memo(({ character, series, isOpen, onClose, onUpdate }: Props) => {
  const [name, setName]             = useState(character.name)
  const [aliases, setAliases]       = useState(character.aliases.join(', '))
  const [description, setDescription] = useState(character.description ?? '')
  const [imageUrl, setImageUrl]     = useState(character.imageUrl ?? '')
  const [introducedAt, setIntroducedAt] = useState(String(character.introducedAt))
  const [diedAt, setDiedAt]         = useState(character.diedAt !== null ? String(character.diedAt) : '')

  // Reset local form state when the selected character changes.
  // Intentionally depends only on character.id so typing doesn't cause a reset.
  useEffect(() => {
    setName(character.name)
    setAliases(character.aliases.join(', '))
    setDescription(character.description ?? '')
    setImageUrl(character.imageUrl ?? '')
    setIntroducedAt(String(character.introducedAt))
    setDiedAt(character.diedAt !== null ? String(character.diedAt) : '')
  }, [character.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = useCallback(
    (patch: Partial<Character>) => onUpdate({ ...character, ...patch }),
    [character, onUpdate],
  )

  // Name propagates immediately so the canvas node label updates while typing.
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value)
    commit({ name: e.target.value })
  }

  const handleAliasesBlur = () => {
    const parsed = aliases.split(',').map(s => s.trim()).filter(Boolean)
    commit({ aliases: parsed })
  }

  const handleDescriptionBlur = () => {
    commit({ description: description.trim() || null })
  }

  const handleImageUrlBlur = () => {
    commit({ imageUrl: imageUrl.trim() || null })
  }

  const handleIntroducedAtBlur = () => {
    const n = parseInt(introducedAt, 10)
    if (!isNaN(n) && n >= 1) commit({ introducedAt: n })
    else setIntroducedAt(String(character.introducedAt)) // revert invalid
  }

  const handleDiedAtBlur = () => {
    if (diedAt.trim() === '') {
      commit({ diedAt: null })
    } else {
      const n = parseInt(diedAt, 10)
      if (!isNaN(n) && n >= 1) commit({ diedAt: n })
      else setDiedAt(character.diedAt !== null ? String(character.diedAt) : '') // revert invalid
    }
  }

  return (
    <aside
      className={[
        'absolute right-3 top-4 bottom-4 w-72 bg-panel border border-border rounded-3xl shadow-xl flex flex-col overflow-hidden',
        'transition-transform duration-[250ms] ease-in-out',
        isOpen ? 'translate-x-0' : 'translate-x-[calc(100%+1rem)]',
      ].join(' ')}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <span className="text-xs uppercase tracking-wider text-white/40 font-medium">
          Edit Character
        </span>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white text-lg leading-none ml-2"
          aria-label="Close panel"
        >
          ✕
        </button>
      </div>

      {/* Form body */}
      <div className="flex flex-col flex-1 overflow-y-auto px-4 py-4 gap-4">
        {/* Name */}
        <Field label="Name" required>
          <input
            type="text"
            value={name}
            onChange={handleNameChange}
            placeholder="Character name"
            className={inputClass}
          />
        </Field>

        {/* Introduced at / Died at */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Introduced" hint={series.unitLabel.toLowerCase()}>
            <input
              type="number"
              min={1}
              max={series.totalUnits}
              value={introducedAt}
              onChange={e => setIntroducedAt(e.target.value)}
              onBlur={handleIntroducedAtBlur}
              className={inputClass}
            />
          </Field>

          <Field label="Died" hint={series.unitLabel.toLowerCase()}>
            <input
              type="number"
              min={1}
              max={series.totalUnits}
              value={diedAt}
              onChange={e => setDiedAt(e.target.value)}
              onBlur={handleDiedAtBlur}
              placeholder="—"
              className={inputClass}
            />
          </Field>
        </div>

        {/* Aliases */}
        <Field label="Aliases" hint="comma-separated">
          <input
            type="text"
            value={aliases}
            onChange={e => setAliases(e.target.value)}
            onBlur={handleAliasesBlur}
            placeholder="Alias 1, Alias 2"
            className={inputClass}
          />
        </Field>

        {/* Description */}
        <Field label="Description">
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            onBlur={handleDescriptionBlur}
            placeholder="Character description…"
            rows={4}
            className={`${inputClass} resize-none`}
          />
        </Field>

        {/* Image URL */}
        <Field label="Image URL">
          <input
            type="url"
            value={imageUrl}
            onChange={e => setImageUrl(e.target.value)}
            onBlur={handleImageUrlBlur}
            placeholder="https://…"
            className={inputClass}
          />
        </Field>
      </div>
    </aside>
  )
})

CharacterEditPanel.displayName = 'CharacterEditPanel'
export default CharacterEditPanel
