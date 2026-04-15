import { memo, useCallback, useEffect, useState, type ReactNode } from 'react'
import type { MediaType, Series } from '../types/domain'

type Props = {
  series: Series
  isOpen: boolean
  onClose: () => void
  onUpdate: (series: Series) => void
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

type TagEntry = { key: string; value: string }

function tagsFromRecord(record: Readonly<Record<string, string>> | undefined): TagEntry[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({ key, value }))
}

function tagsToRecord(tags: TagEntry[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const { key, value } of tags) {
    const k = key.trim()
    if (k) out[k] = value
  }
  return out
}

// ---------------------------------------------------------------------------
// GraphMetadataPanel
// ---------------------------------------------------------------------------

const GraphMetadataPanel = memo(({ series, isOpen, onClose, onUpdate }: Props) => {
  const [title, setTitle]       = useState(series.title)
  const [mediaType, setMediaType] = useState<MediaType>(series.mediaType)
  const [unitLabel, setUnitLabel] = useState(series.unitLabel)
  const [author, setAuthor]     = useState(series.author ?? '')
  const [groupType, setGroupType] = useState(series.groupType ?? '')
  const [tags, setTags]         = useState<TagEntry[]>(() => tagsFromRecord(series.customMetadata))

  // Reset when series identity changes
  useEffect(() => {
    setTitle(series.title)
    setMediaType(series.mediaType)
    setUnitLabel(series.unitLabel)
    setAuthor(series.author ?? '')
    setGroupType(series.groupType ?? '')
    setTags(tagsFromRecord(series.customMetadata))
  }, [series.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = useCallback(
    (patch: Partial<Series>) => onUpdate({ ...series, ...patch }),
    [series, onUpdate],
  )

  const commitTags = useCallback(
    (next: TagEntry[]) => {
      const record = tagsToRecord(next)
      commit({ customMetadata: Object.keys(record).length > 0 ? record : undefined })
    },
    [commit],
  )

  const handleTagKeyBlur = (i: number) => {
    commitTags(tags)
    // Normalise key: lowercase, spaces → underscores
    const normalised = tags[i]!.key.trim().toLowerCase().replace(/\s+/g, '_')
    if (normalised !== tags[i]!.key) {
      const next = tags.map((t, idx) => idx === i ? { ...t, key: normalised } : t)
      setTags(next)
      commitTags(next)
    }
  }

  const handleTagValueChange = (i: number, value: string) => {
    const next = tags.map((t, idx) => idx === i ? { ...t, value } : t)
    setTags(next)
    commitTags(next)
  }

  const handleAddTag = () => {
    setTags(prev => [...prev, { key: '', value: '' }])
  }

  const handleRemoveTag = (i: number) => {
    const next = tags.filter((_, idx) => idx !== i)
    setTags(next)
    commitTags(next)
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
          Graph Metadata
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

        {/* Title */}
        <Field label="Title">
          <input
            type="text"
            value={title}
            onChange={e => { setTitle(e.target.value); commit({ title: e.target.value }) }}
            placeholder="Series title"
            className={inputClass}
          />
        </Field>

        {/* Media type */}
        <Field label="Media type">
          <select
            value={mediaType}
            onChange={e => {
              const v = e.target.value as MediaType
              setMediaType(v)
              commit({ mediaType: v })
            }}
            className={selectClass}
          >
            <option value="book">Book</option>
            <option value="show">Show</option>
            <option value="film">Film</option>
          </select>
        </Field>

        {/* Author */}
        <Field label="Author" hint="optional">
          <input
            type="text"
            value={author}
            onChange={e => setAuthor(e.target.value)}
            onBlur={() => commit({ author: author.trim() || undefined })}
            placeholder="Author name"
            className={inputClass}
          />
        </Field>

        <div className="border-t border-border" />

        {/* Unit label */}
        <Field label="Unit label" hint="chapter / episode / part…">
          <input
            type="text"
            value={unitLabel}
            onChange={e => setUnitLabel(e.target.value)}
            onBlur={() => {
              const trimmed = unitLabel.trim() || 'Chapter'
              setUnitLabel(trimmed)
              commit({ unitLabel: trimmed })
            }}
            placeholder="Chapter"
            className={inputClass}
          />
        </Field>

        {/* Group type */}
        <Field label="Group type" hint="volume / season / arc…">
          <input
            type="text"
            value={groupType}
            onChange={e => setGroupType(e.target.value)}
            onBlur={() => commit({ groupType: groupType.trim() || undefined })}
            placeholder="Volume"
            className={inputClass}
          />
        </Field>

        <div className="border-t border-border" />

        {/* Custom metadata tags */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-white/40">
              Custom tags
            </span>
            <button
              onClick={handleAddTag}
              className="text-[10px] text-white/40 hover:text-white transition-colors px-1.5 py-0.5 rounded border border-transparent hover:border-white/20"
            >
              + Add tag
            </button>
          </div>

          {tags.length === 0 && (
            <p className="text-[11px] text-white/25 italic">
              No custom tags. Click + Add tag to define one.
            </p>
          )}

          {tags.map((tag, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                type="text"
                value={tag.key}
                onChange={e => {
                  const next = tags.map((t, idx) => idx === i ? { ...t, key: e.target.value } : t)
                  setTags(next)
                }}
                onBlur={() => handleTagKeyBlur(i)}
                placeholder="key"
                className={`${inputClass} flex-1 min-w-0`}
              />
              <span className="text-white/20 text-xs shrink-0">:</span>
              <input
                type="text"
                value={tag.value}
                onChange={e => handleTagValueChange(i, e.target.value)}
                placeholder="value"
                className={`${inputClass} flex-[2] min-w-0`}
              />
              <button
                onClick={() => handleRemoveTag(i)}
                className="shrink-0 text-white/25 hover:text-red-400 transition-colors text-sm leading-none"
                aria-label="Remove tag"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
})

GraphMetadataPanel.displayName = 'GraphMetadataPanel'
export default GraphMetadataPanel
