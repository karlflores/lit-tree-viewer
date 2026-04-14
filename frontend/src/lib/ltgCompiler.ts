import type { Character, GraphSnapshot, Relationship, Series } from '../types/domain'
import type { CompileSuccess } from './ltgLspClient'

// ---------------------------------------------------------------------------
// Raw shapes from the language server (matches openapi-langserver.yaml)
// ---------------------------------------------------------------------------

type RawSeries = {
  title:      string
  mediaType:  'book' | 'show' | 'film'
  unitLabel:  string
  totalUnits: number
  author:     string | null
  groupType:  string | null
}

type RawRename = {
  name:         string
  introducedAt: number
}

type RawCharacter = {
  identifier:   string
  name:         string
  aliases:      string[]
  renames:      RawRename[]
  introducedAt: number
  diedAt:       number | null
}

type RawRelationship = {
  fromIdentifier: string
  toIdentifier:   string
  label:          string
  directed:       boolean
  introducedAt:   number
  endedAt:        number | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PREVIEW_SERIES_ID = 'preview'

/** Resolve a character's display name at a given unit (most recent rename ≤ unit). */
function effectiveName(char: RawCharacter, atUnit: number): string {
  const applicable = char.renames
    .filter(r => r.introducedAt <= atUnit)
    .sort((a, b) => b.introducedAt - a.introducedAt)
  return applicable[0]?.name ?? char.name
}

// ---------------------------------------------------------------------------
// Main conversion
// ---------------------------------------------------------------------------

/**
 * Convert a `CompileSuccess` graph (full history, identifier-keyed) into a
 * `GraphSnapshot` (time-sliced to `atUnit`, UUID-compatible string IDs).
 *
 * Character IDs are set to the LTG identifier so they remain stable across
 * unit changes and relationship edges resolve correctly without a UUID map.
 */
export function compiledToSnapshot(raw: CompileSuccess, atUnit: number): GraphSnapshot {
  const rawSeries  = raw.series        as RawSeries
  const rawChars   = raw.characters    as RawCharacter[]
  const rawRels    = raw.relationships as RawRelationship[]

  const clampedUnit = Math.min(Math.max(1, atUnit), rawSeries.totalUnits)

  const series: Series = {
    id:         PREVIEW_SERIES_ID,
    title:      rawSeries.title,
    mediaType:  rawSeries.mediaType,
    unitLabel:  rawSeries.unitLabel,
    totalUnits: rawSeries.totalUnits,
  }

  const characters: Character[] = rawChars
    .filter(c => c.introducedAt <= clampedUnit)
    .map(c => {
      const renames = c.renames.filter(r => r.introducedAt <= clampedUnit)
      return {
        id:            c.identifier,
        seriesId:      PREVIEW_SERIES_ID,
        name:          effectiveName(c, clampedUnit),
        aliases:       c.aliases,
        ...(renames.length > 0 ? { renames } : {}),
        description:   null,
        imageUrl:      null,
        introducedAt:  c.introducedAt,
        diedAt:        c.diedAt,
        ltgIdentifier: c.identifier,
      }
    })

  const relationships: Relationship[] = rawRels
    .filter(r =>
      r.introducedAt <= clampedUnit &&
      (r.endedAt === null || r.endedAt >= clampedUnit),
    )
    .map(r => ({
      id:           `${r.fromIdentifier}::${r.label}::${r.toIdentifier}`,
      seriesId:     PREVIEW_SERIES_ID,
      fromId:       r.fromIdentifier,
      toId:         r.toIdentifier,
      label:        r.label,
      directed:     r.directed,
      introducedAt: r.introducedAt,
      endedAt:      r.endedAt,
    }))

  return { series, characters, relationships, atUnit: clampedUnit, colours: raw.colours as Record<string, string> }
}
