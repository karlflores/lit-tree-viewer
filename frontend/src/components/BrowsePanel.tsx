import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { SeriesSummary } from '../types/domain'
import { searchSeries, type SearchParams } from '../api/client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SortBy   = NonNullable<SearchParams['sortBy']>
type SortDir  = NonNullable<SearchParams['sortDir']>
type MediaFilter = 'book' | 'show' | 'film'

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'title',           label: 'Title'      },
  { value: 'author',          label: 'Author'     },
  { value: 'media_type',      label: 'Media type' },
  { value: 'total_units',     label: 'Chapters'   },
  { value: 'character_count', label: 'Characters' },
]

const MEDIA_LABELS: Record<MediaFilter, string> = {
  book: 'Book',
  show: 'Show',
  film: 'Film',
}

const PAGE_SIZE = 20

type Props = {
  isOpen:         boolean
  onClose:        () => void
  onSelectSeries: (id: string) => void
}

// ---------------------------------------------------------------------------
// SeriesCard
// ---------------------------------------------------------------------------

function MediaBadge({ type }: { type: string }) {
  const colours: Record<string, string> = {
    book: 'bg-indigo-500/20 text-indigo-300',
    show: 'bg-emerald-500/20 text-emerald-300',
    film: 'bg-amber-500/20  text-amber-300',
  }
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${colours[type] ?? 'bg-white/10 text-white/50'}`}>
      {type}
    </span>
  )
}

function SeriesCard({
  series,
  onSelect,
}: {
  series: SeriesSummary
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className="w-full text-left px-3 py-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-transparent hover:border-white/10 transition-colors group"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-sm text-white font-medium leading-snug group-hover:text-white/90 line-clamp-2">
          {series.title}
        </span>
        <MediaBadge type={series.mediaType} />
      </div>
      {series.author && (
        <p className="text-[11px] text-white/40 mb-1.5 truncate">{series.author}</p>
      )}
      <div className="flex items-center gap-3 text-[10px] text-white/30">
        <span>{series.totalUnits} {series.unitLabel.toLowerCase()}s</span>
        <span>·</span>
        <span>{series.characterCount} character{series.characterCount !== 1 ? 's' : ''}</span>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// BrowsePanel
// ---------------------------------------------------------------------------

const BrowsePanel = memo(({ isOpen, onClose, onSelectSeries }: Props) => {
  const [query,      setQuery]      = useState('')
  const [mediaFilters, setMediaFilters] = useState<Set<MediaFilter>>(new Set())
  const [sortBy,     setSortBy]     = useState<SortBy>('title')
  const [sortDir,    setSortDir]    = useState<SortDir>('asc')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const [results,  setResults]  = useState<SeriesSummary[]>([])
  const [total,    setTotal]    = useState(0)
  const [offset,   setOffset]   = useState(0)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track the latest search so stale responses from slower requests don't
  // overwrite results from a newer one.
  const searchSeqRef = useRef(0)

  const runSearch = useCallback(async (
    q: string,
    filters: Set<MediaFilter>,
    by: SortBy,
    dir: SortDir,
    off: number,
    append: boolean,
  ) => {
    const seq = ++searchSeqRef.current
    setLoading(true)
    setError(false)

    const params: SearchParams = {
      sortBy: by,
      sortDir: dir,
      limit: PAGE_SIZE,
      offset: off,
    }
    if (q.trim()) params.q = q.trim()
    if (filters.size > 0) params.mediaType = [...filters].join(',')

    const result = await searchSeries(params)

    if (seq !== searchSeqRef.current) return // superseded
    setLoading(false)

    if (result.isErr()) {
      setError(true)
      return
    }

    const { results: rows, total: t } = result.value
    setTotal(t)
    setResults(prev => append ? [...prev, ...rows] : rows)
  }, [])

  // Debounce re-search whenever query / filters / sort change.
  useEffect(() => {
    setOffset(0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      runSearch(query, mediaFilters, sortBy, sortDir, 0, false)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, mediaFilters, sortBy, sortDir, runSearch])

  // Initial load when panel is first opened.
  useEffect(() => {
    if (isOpen) runSearch('', new Set(), 'title', 'asc', 0, false)
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoadMore = useCallback(() => {
    const nextOffset = offset + PAGE_SIZE
    setOffset(nextOffset)
    runSearch(query, mediaFilters, sortBy, sortDir, nextOffset, true)
  }, [query, mediaFilters, sortBy, sortDir, offset, runSearch])

  const toggleMedia = (m: MediaFilter) => {
    setMediaFilters(prev => {
      const next = new Set(prev)
      next.has(m) ? next.delete(m) : next.add(m)
      return next
    })
  }

  const toggleSortDir = () => setSortDir(d => d === 'asc' ? 'desc' : 'asc')

  const hasMore = results.length < total

  return (
    <aside
      className={[
        'absolute left-3 top-4 bottom-4 w-80 bg-panel border border-border rounded-3xl shadow-xl flex flex-col overflow-hidden',
        'transition-transform duration-[250ms] ease-in-out',
        isOpen ? 'translate-x-0' : '-translate-x-[calc(100%+1rem)]',
      ].join(' ')}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <span className="text-sm font-semibold text-white">Browse Media</span>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white text-lg leading-none ml-2"
          aria-label="Close browse panel"
        >
          ✕
        </button>
      </div>

      {/* ── Search bar ──────────────────────────────────────────────────── */}
      <div className="px-3 pt-3 pb-2 shrink-0 flex flex-col gap-2">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25 pointer-events-none"
            width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true"
          >
            <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.5" />
            <path d="M9 9l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by title or author…"
            className="w-full bg-white/5 border border-border rounded-xl pl-8 pr-8 py-2 text-xs text-white placeholder:text-white/25 outline-none focus:border-white/30 transition-colors"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white transition-colors"
              aria-label="Clear search"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>

        {/* ── Filter toggle row ──────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFiltersOpen(o => !o)}
            className={[
              'flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg border transition-colors',
              filtersOpen || mediaFilters.size > 0
                ? 'border-white/30 text-white bg-white/8'
                : 'border-border text-white/40 hover:text-white hover:border-white/20',
            ].join(' ')}
          >
            <FilterIcon />
            Filters
            {mediaFilters.size > 0 && (
              <span className="bg-white/20 text-white rounded-full text-[9px] w-4 h-4 flex items-center justify-center font-medium">
                {mediaFilters.size}
              </span>
            )}
          </button>

          <div className="flex items-center gap-1 ml-auto">
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortBy)}
              className="bg-transparent border border-border rounded-lg text-[11px] text-white/50 pl-2 pr-6 py-1 outline-none focus:border-white/30 transition-colors cursor-pointer appearance-none"
              style={{ backgroundImage: 'none' }}
            >
              {SORT_OPTIONS.map(o => (
                <option key={o.value} value={o.value} className="bg-[#1a1d27]">
                  {o.label}
                </option>
              ))}
            </select>
            <button
              onClick={toggleSortDir}
              className="p-1.5 rounded-lg border border-border text-white/40 hover:text-white hover:border-white/20 transition-colors"
              aria-label={sortDir === 'asc' ? 'Sort descending' : 'Sort ascending'}
              title={sortDir === 'asc' ? 'Ascending' : 'Descending'}
            >
              <SortDirIcon dir={sortDir} />
            </button>
          </div>
        </div>

        {/* ── Filter strip ──────────────────────────────────────────── */}
        {filtersOpen && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {(['book', 'show', 'film'] as MediaFilter[]).map(m => (
              <button
                key={m}
                onClick={() => toggleMedia(m)}
                className={[
                  'text-[11px] px-2.5 py-1 rounded-full border transition-colors',
                  mediaFilters.has(m)
                    ? 'border-white/40 text-white bg-white/10'
                    : 'border-border text-white/40 hover:text-white hover:border-white/20',
                ].join(' ')}
              >
                {MEDIA_LABELS[m]}
              </button>
            ))}
            {mediaFilters.size > 0 && (
              <button
                onClick={() => setMediaFilters(new Set())}
                className="text-[10px] text-white/30 hover:text-white/60 transition-colors ml-1"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Results ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">

        {/* Result count */}
        {!loading && !error && (
          <p className="text-[10px] text-white/25 mb-2 px-1">
            {total === 0
              ? 'No results'
              : `${total} result${total !== 1 ? 's' : ''}${results.length < total ? ` — showing ${results.length}` : ''}`
            }
          </p>
        )}

        {error && (
          <p className="text-[12px] text-red-400/70 text-center py-6">
            Failed to load results. Is the backend running?
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          {results.map(s => (
            <SeriesCard
              key={s.id}
              series={s}
              onSelect={() => { onSelectSeries(s.id); onClose() }}
            />
          ))}
        </div>

        {/* Loading skeleton */}
        {loading && results.length === 0 && (
          <div className="flex flex-col gap-1.5 mt-1">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-white/[0.03] animate-pulse" />
            ))}
          </div>
        )}

        {/* Load more */}
        {hasMore && !loading && (
          <button
            onClick={handleLoadMore}
            className="w-full mt-2 py-2 text-[11px] text-white/40 hover:text-white border border-border hover:border-white/20 rounded-xl transition-colors"
          >
            Load more
          </button>
        )}

        {loading && results.length > 0 && (
          <p className="text-center text-[11px] text-white/30 py-3">Loading…</p>
        )}
      </div>
    </aside>
  )
})

BrowsePanel.displayName = 'BrowsePanel'
export default BrowsePanel

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function FilterIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
      <path d="M1 2h9M2.5 5.5h6M4 9h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function SortDirIcon({ dir }: { dir: SortDir }) {
  return dir === 'asc' ? (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
      <path d="M5.5 9V2M2.5 5l3-3 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
      <path d="M5.5 2v7M2.5 6l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
