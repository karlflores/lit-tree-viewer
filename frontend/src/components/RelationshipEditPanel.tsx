import { memo, useCallback, useEffect, useState, type ReactNode } from 'react'
import Toggle from './Toggle'
import type { Relationship, RelationshipKind, Series } from '../types/domain'

type Props = {
  relationship: Relationship
  series: Series
  isOpen: boolean
  onClose: () => void
  onUpdate: (relationship: Relationship) => void
  onDelete: (id: string) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const inputClass =
  'w-full bg-white/5 border border-border rounded-lg px-3 py-1.5 text-xs text-white ' +
  'placeholder:text-white/25 outline-none focus:border-white/30 transition-colors'

const selectClass =
  'w-full bg-panel border border-border rounded-lg px-3 py-1.5 text-xs text-white ' +
  'outline-none focus:border-white/30 transition-colors cursor-pointer'

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] uppercase tracking-wider text-white/40 flex items-center gap-1.5">
        {label}
        {hint && <span className="normal-case tracking-normal text-white/25">({hint})</span>}
      </label>
      {children}
    </div>
  )
}

const RELATIONSHIP_KINDS: { value: RelationshipKind; label: string }[] = [
  { value: 'ally',         label: 'Ally'           },
  { value: 'enemy',        label: 'Enemy'          },
  { value: 'family',       label: 'Family'         },
  { value: 'mentor',       label: 'Mentor'         },
  { value: 'parent_child', label: 'Parent / Child' },
  { value: 'rival',        label: 'Rival'          },
  { value: 'romantic',     label: 'Romantic'       },
  { value: 'other',        label: 'Other'          },
]

// ---------------------------------------------------------------------------
// RelationshipEditPanel
// ---------------------------------------------------------------------------

const RelationshipEditPanel = memo(({ relationship, series, isOpen, onClose, onUpdate, onDelete }: Props) => {
  const [label, setLabel]           = useState(relationship.label)
  const [kind, setKind]             = useState<RelationshipKind>(relationship.kind ?? 'ally')
  const [directed, setDirected]     = useState(relationship.directed)
  const [introducedAt, setIntroducedAt] = useState(String(relationship.introducedAt))
  const [endedAt, setEndedAt]       = useState(relationship.endedAt !== null ? String(relationship.endedAt) : '')

  // Reset when a different relationship is selected.
  useEffect(() => {
    setLabel(relationship.label)
    setKind(relationship.kind ?? 'ally')
    setDirected(relationship.directed)
    setIntroducedAt(String(relationship.introducedAt))
    setEndedAt(relationship.endedAt !== null ? String(relationship.endedAt) : '')
  }, [relationship.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = useCallback(
    (patch: Partial<Relationship>) => onUpdate({ ...relationship, ...patch }),
    [relationship, onUpdate],
  )

  // Label propagates immediately so the canvas edge label updates while typing.
  const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLabel(e.target.value)
    commit({ label: e.target.value })
  }

  const handleKindChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as RelationshipKind
    setKind(val)
    // When kind changes, also sync label to the new kind's default name
    // so the edge label stays meaningful.
    const defaultLabel = RELATIONSHIP_KINDS.find(k => k.value === val)?.label.toLowerCase() ?? val
    setLabel(defaultLabel)
    commit({ kind: val, label: defaultLabel })
  }

  const handleDirectedChange = (checked: boolean) => {
    setDirected(checked)
    commit({ directed: checked })
  }

  const handleIntroducedAtBlur = () => {
    const n = parseInt(introducedAt, 10)
    if (!isNaN(n) && n >= 1) commit({ introducedAt: n })
    else setIntroducedAt(String(relationship.introducedAt))
  }

  const handleEndedAtBlur = () => {
    if (endedAt.trim() === '') {
      commit({ endedAt: null })
    } else {
      const n = parseInt(endedAt, 10)
      if (!isNaN(n) && n >= 1) commit({ endedAt: n })
      else setEndedAt(relationship.endedAt !== null ? String(relationship.endedAt) : '')
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
          Edit Relationship
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
        {/* Label */}
        <Field label="Label">
          <input
            type="text"
            value={label}
            onChange={handleLabelChange}
            placeholder="e.g. rival, father, ally…"
            className={inputClass}
          />
        </Field>

        {/* Kind */}
        <Field label="Kind">
          <select
            value={kind}
            onChange={handleKindChange}
            className={selectClass}
          >
            {RELATIONSHIP_KINDS.map(k => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </Field>

        {/* Directed toggle + flip */}
        <Field label="Direction">
          <div className="flex items-center justify-between py-1">
            <span className="text-xs text-white/50">
              {directed ? 'Directed' : 'Undirected (mutual)'}
            </span>
            <div className="flex items-center gap-2">
              {directed && (
                <button
                  onClick={() => commit({ fromId: relationship.toId, toId: relationship.fromId })}
                  className="text-white/40 hover:text-white transition-colors"
                  title="Flip direction"
                  aria-label="Flip direction"
                >
                  <FlipIcon />
                </button>
              )}
              <Toggle
                checked={directed}
                onChange={handleDirectedChange}
                label=""
              />
            </div>
          </div>
        </Field>

        {/* Introduced at / Ended at */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" hint={series.unitLabel.toLowerCase()}>
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

          <Field label="Until" hint={series.unitLabel.toLowerCase()}>
            <input
              type="number"
              min={1}
              max={series.totalUnits}
              value={endedAt}
              onChange={e => setEndedAt(e.target.value)}
              onBlur={handleEndedAtBlur}
              placeholder="—"
              className={inputClass}
            />
          </Field>
        </div>
      </div>

      {/* Delete button */}
      <div className="px-4 py-3 border-t border-border shrink-0">
        <button
          onClick={() => onDelete(relationship.id)}
          className="w-full py-2 rounded-lg text-xs font-medium text-red-400/70 hover:text-red-400 hover:bg-red-400/10 border border-transparent hover:border-red-400/20 transition-colors"
        >
          Delete relationship
        </button>
      </div>
    </aside>
  )
})

RelationshipEditPanel.displayName = 'RelationshipEditPanel'
export default RelationshipEditPanel

function FlipIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 4.5h10M9.5 2l2.5 2.5L9.5 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 9.5H2M4.5 7l-2.5 2.5L4.5 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
