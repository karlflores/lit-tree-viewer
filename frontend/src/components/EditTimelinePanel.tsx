import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import type { BlockGroup, Series } from '../types/domain'

type Props = {
  series:   Series
  isOpen:   boolean
  onClose:  () => void
  onUpdate: (series: Series) => void
}

// ---------------------------------------------------------------------------
// Shared input styles (mirrors GraphMetadataPanel)
// ---------------------------------------------------------------------------

const inputClass =
  'w-full bg-white/5 border border-border rounded-lg px-3 py-1.5 text-xs text-white ' +
  'placeholder:text-white/25 outline-none focus:border-white/30 transition-colors'

const smallInputClass =
  'w-12 bg-white/5 border border-border rounded px-2 py-1 text-xs text-white text-center ' +
  'outline-none focus:border-white/30 transition-colors ' +
  '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

type GroupEntry = { label: string; from: number; to: number }

// ---------------------------------------------------------------------------
// EditTimelinePanel
// ---------------------------------------------------------------------------

const EditTimelinePanel = memo(({ series, isOpen, onClose, onUpdate }: Props) => {
  const [labels, setLabels] = useState<Record<number, string>>(() => ({
    ...(series.blockLabels ?? {}),
  }))
  const [groups, setGroups] = useState<GroupEntry[]>(() =>
    (series.blockGroups ?? []).map(g => ({
      label: g.label,
      from:  g.range[0],
      to:    g.range[1],
    })),
  )

  // Sync when series identity or chapter count changes (e.g. Add/Remove Chapter).
  useEffect(() => {
    setLabels({ ...(series.blockLabels ?? {}) })
    setGroups(
      (series.blockGroups ?? []).map(g => ({
        label: g.label,
        from:  g.range[0],
        to:    g.range[1],
      })),
    )
  }, [series.id, series.totalUnits]) // eslint-disable-line react-hooks/exhaustive-deps

  // Push updates to the parent (and ultimately to editGraph).
  const commit = useCallback(
    (newLabels: Record<number, string>, newGroups: GroupEntry[]) => {
      const blockLabels = Object.fromEntries(
        Object.entries(newLabels)
          .map(([k, v]) => [Number(k), v.trim()] as [number, string])
          .filter(([, v]) => v),
      ) as Record<number, string>

      const blockGroups: BlockGroup[] = newGroups
        .filter(
          g =>
            g.label.trim() &&
            g.from >= 2 &&
            g.to >= g.from &&
            g.to <= series.totalUnits,
        )
        .map(g => ({ label: g.label.trim(), range: [g.from, g.to] as [number, number] }))

      onUpdate({
        ...series,
        blockLabels: Object.keys(blockLabels).length > 0 ? blockLabels : undefined,
        blockGroups: blockGroups.length > 0 ? blockGroups : undefined,
      })
    },
    [series, onUpdate],
  )

  // Which blocks already belong to a group — used for the dot indicator.
  const blocksInGroup = useMemo(() => {
    const set = new Set<number>()
    for (const g of groups) {
      for (let b = g.from; b <= Math.min(g.to, series.totalUnits); b++) set.add(b)
    }
    return set
  }, [groups, series.totalUnits])

  // ── Label handlers ─────────────────────────────────────────────────────────

  const handleLabelChange = (unit: number, value: string) => {
    setLabels(prev => ({ ...prev, [unit]: value }))
  }

  const handleLabelBlur = (unit: number) => {
    commit(labels, groups)
    // Remove the entry if the user cleared it.
    if (!labels[unit]?.trim()) {
      setLabels(prev => {
        const next = { ...prev }
        delete next[unit]
        return next
      })
    }
  }

  // ── Group handlers ─────────────────────────────────────────────────────────

  const handleGroupChange = (i: number, patch: Partial<GroupEntry>) => {
    const next = groups.map((g, idx) => (idx === i ? { ...g, ...patch } : g))
    setGroups(next)
    commit(labels, next)
  }

  const handleAddGroup = () => {
    // Start from the first ungrouped block after init.
    let from = 2
    while (blocksInGroup.has(from) && from <= series.totalUnits) from++
    if (from > series.totalUnits) from = 2   // fallback if all are grouped
    const to = Math.min(from + 1, series.totalUnits)
    setGroups(prev => [...prev, { label: '', from, to }])
    // Don't commit yet — label is empty and would be filtered out anyway.
  }

  const handleRemoveGroup = (i: number) => {
    const next = groups.filter((_, idx) => idx !== i)
    setGroups(next)
    commit(labels, next)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

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
          Edit Timeline
        </span>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white text-lg leading-none ml-2"
          aria-label="Close panel"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-col flex-1 overflow-y-auto px-4 py-4 gap-4">

        {/* ── Block labels ───────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-wider text-white/40">
            Block labels
          </span>
          <p className="text-[11px] text-white/25">
            Assign display labels to individual {series.unitLabel.toLowerCase()}s.
          </p>

          <div className="flex flex-col gap-1.5 mt-0.5">
            {/* Block 1 is always the init block — its label cannot be overridden */}
            <div className="flex items-center gap-2 opacity-35">
              <span className="text-[10px] text-white/50 w-16 shrink-0 tabular-nums">
                {series.unitLabel} 1
              </span>
              <span className="text-[10px] text-white/40 italic">init (fixed)</span>
            </div>

            {series.totalUnits < 2 && (
              <p className="text-[11px] text-white/25 italic">
                Add more {series.unitLabel.toLowerCase()}s to assign labels.
              </p>
            )}

            {Array.from({ length: Math.max(0, series.totalUnits - 1) }, (_, i) => i + 2).map(unit => (
              <div key={unit} className="flex items-center gap-2">
                <span className="text-[10px] text-white/40 w-16 shrink-0 tabular-nums">
                  {series.unitLabel} {unit}
                  {blocksInGroup.has(unit) && (
                    <span className="ml-1 text-white/20" title="In a group">●</span>
                  )}
                </span>
                <input
                  type="text"
                  value={labels[unit] ?? ''}
                  onChange={e => handleLabelChange(unit, e.target.value)}
                  onBlur={() => handleLabelBlur(unit)}
                  placeholder="Unlabelled"
                  className={`${inputClass} py-1`}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-border" />

        {/* ── Groups ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-white/40">
              Groups
            </span>
            <button
              onClick={handleAddGroup}
              disabled={series.totalUnits < 2}
              className="text-[10px] text-white/40 hover:text-white transition-colors px-1.5 py-0.5 rounded border border-transparent hover:border-white/20 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              + Add group
            </button>
          </div>

          {groups.length === 0 ? (
            <p className="text-[11px] text-white/25 italic">
              No groups yet. Groups let you organise{' '}
              {series.unitLabel.toLowerCase()}s into arcs, volumes, or seasons.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {groups.map((g, i) => (
                <div key={i} className="flex flex-col gap-1.5 bg-white/[0.03] rounded-xl p-2.5">
                  <input
                    type="text"
                    value={g.label}
                    onChange={e => handleGroupChange(i, { label: e.target.value })}
                    placeholder={`Group name (e.g. ${series.groupType ? series.groupType.charAt(0).toUpperCase() + series.groupType.slice(1) + ' I' : 'Volume I'})`}
                    className={inputClass}
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-white/30">from</span>
                      <input
                        type="number"
                        min={2}
                        max={g.to}
                        value={g.from}
                        onChange={e => {
                          const from = Math.max(2, Math.min(g.to, Number(e.target.value)))
                          handleGroupChange(i, { from })
                        }}
                        className={smallInputClass}
                      />
                      <span className="text-[10px] text-white/30">to</span>
                      <input
                        type="number"
                        min={g.from}
                        max={series.totalUnits}
                        value={g.to}
                        onChange={e => {
                          const to = Math.max(g.from, Math.min(series.totalUnits, Number(e.target.value)))
                          handleGroupChange(i, { to })
                        }}
                        className={smallInputClass}
                      />
                    </div>
                    <button
                      onClick={() => handleRemoveGroup(i)}
                      className="text-white/25 hover:text-red-400 transition-colors text-sm leading-none"
                      aria-label="Remove group"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </aside>
  )
})

EditTimelinePanel.displayName = 'EditTimelinePanel'
export default EditTimelinePanel
