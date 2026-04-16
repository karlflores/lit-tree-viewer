import type { GraphSnapshot } from '../types/domain'

// ---------------------------------------------------------------------------
// ImportPayload — matches the backend domain.ImportPayload shape
// ---------------------------------------------------------------------------

export type ImportSeries = {
  title:          string
  mediaType:      'book' | 'show' | 'film'
  unitLabel:      string
  totalUnits:     number
  author?:        string | null
  groupType?:     string | null
  customMetadata?: Record<string, string>
}

export type ImportCharacter = {
  id:           string
  name:         string
  aliases:      string[]
  description?: string | null
  imageUrl?:    string | null
  introducedAt: number
  diedAt?:      number | null
}

export type ImportRelationship = {
  id:           string
  fromId:       string
  toId:         string
  kind?:        string | null
  label:        string
  directed:     boolean
  introducedAt: number
  endedAt?:     number | null
}

export type ImportPayload = {
  series:        ImportSeries
  characters:    ImportCharacter[]
  relationships: ImportRelationship[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Returns true when the series id is a real backend UUID (not `edit:*` or `"preview"`).
 * Used to decide whether to POST (create) or PATCH (update) on save.
 */
export function isBackendId(id: string): boolean {
  return UUID_RE.test(id)
}

/**
 * Build a stable UUID for a character/relationship ID.
 * Canvas-created nodes already have UUIDs; compiled-derived nodes use LTG
 * identifiers (e.g. "edmond_dantes") — generate a UUID for those.
 * Returns the same UUID for a given id within one call to graphSnapshotToImport.
 */
function ensureUUID(id: string, memo: Map<string, string>): string {
  if (UUID_RE.test(id)) return id
  const cached = memo.get(id)
  if (cached) return cached
  const fresh = crypto.randomUUID()
  memo.set(id, fresh)
  return fresh
}

/**
 * Convert a `GraphSnapshot` (the full edit graph, not a temporally-filtered
 * display snapshot) into an `ImportPayload` suitable for POST /api/series or
 * PATCH /api/series/:id.
 *
 * Also returns an `idMap` (old id → new UUID) so the caller can remap
 * character/relationship ids in `editGraph` after a successful POST, keeping
 * subsequent PATCH calls stable.
 */
export function graphSnapshotToImport(graph: GraphSnapshot): {
  payload: ImportPayload
  idMap: Map<string, string>
} {
  const idMap = new Map<string, string>()

  const characters: ImportCharacter[] = graph.characters.map(c => ({
    id:           ensureUUID(c.id, idMap),
    name:         c.name,
    aliases:      Array.from(c.aliases ?? []),
    description:  c.description ?? null,
    imageUrl:     c.imageUrl ?? null,
    introducedAt: c.introducedAt,
    diedAt:       c.diedAt ?? null,
  }))

  const relationships: ImportRelationship[] = graph.relationships.map(r => ({
    id:           ensureUUID(r.id, idMap),
    fromId:       ensureUUID(r.fromId, idMap),
    toId:         ensureUUID(r.toId, idMap),
    kind:         r.kind ?? null,
    label:        r.label,
    directed:     r.directed,
    introducedAt: r.introducedAt,
    endedAt:      r.endedAt ?? null,
  }))

  const payload: ImportPayload = {
    series: {
      title:          graph.series.title,
      mediaType:      graph.series.mediaType,
      unitLabel:      graph.series.unitLabel,
      totalUnits:     graph.series.totalUnits,
      author:         graph.series.author ?? null,
      groupType:      graph.series.groupType ?? null,
      customMetadata: graph.series.customMetadata,
    },
    characters,
    relationships,
  }

  return { payload, idMap }
}

/**
 * After a successful POST, apply the id remapping back to `editGraph` so that
 * all character/relationship ids are real UUIDs for subsequent PATCH calls.
 */
export function applyIdRemap(
  graph: GraphSnapshot,
  newSeriesId: string,
  idMap: Map<string, string>,
): GraphSnapshot {
  const remap = (id: string) => idMap.get(id) ?? id
  return {
    ...graph,
    series:        { ...graph.series, id: newSeriesId },
    characters:    graph.characters.map(c => ({ ...c, id: remap(c.id), seriesId: newSeriesId })),
    relationships: graph.relationships.map(r => ({
      ...r,
      id:       remap(r.id),
      seriesId: newSeriesId,
      fromId:   remap(r.fromId),
      toId:     remap(r.toId),
    })),
  }
}
