import type { Character, GraphSnapshot, Relationship, Series } from '../types/domain'
import type { EditableGraph } from '../types/editGraph'

/**
 * Convert an `EditableGraph` to a `GraphSnapshot` at a given unit.
 *
 * Mirrors the filtering logic in `compiledToSnapshot`:
 *   - Characters whose `introducedAt` > `atUnit` are excluded.
 *   - Relationships whose `introducedAt` > `atUnit` are excluded.
 *   - Relationships whose `endedAt` < `atUnit` are excluded.
 *   - Relationships referencing a character not present at `atUnit` are excluded.
 *   - `atUnit` is clamped to [1, totalUnits].
 */
export function editableToSnapshot(graph: EditableGraph, atUnit: number): GraphSnapshot {
  const clampedUnit = Math.min(Math.max(1, atUnit), graph.totalUnits)

  const series: Series = {
    id:         graph.id,
    title:      graph.title,
    mediaType:  graph.mediaType,
    unitLabel:  graph.unitLabel,
    totalUnits: graph.totalUnits,
  }

  const characters: Character[] = graph.characters
    .filter(c => c.introducedAt <= clampedUnit)
    .map(c => ({
      id:           c.id,
      seriesId:     graph.id,
      name:         c.name,
      aliases:      c.aliases,
      description:  c.description,
      imageUrl:     c.imageUrl,
      introducedAt: c.introducedAt,
      diedAt:       c.diedAt,
    }))

  const presentIds = new Set(characters.map(c => c.id))

  const relationships: Relationship[] = graph.relationships
    .filter(r =>
      r.introducedAt <= clampedUnit &&
      (r.endedAt === null || r.endedAt >= clampedUnit) &&
      presentIds.has(r.fromId) &&
      presentIds.has(r.toId),
    )
    .map(r => ({
      id:           r.id,
      seriesId:     graph.id,
      fromId:       r.fromId,
      toId:         r.toId,
      label:        r.label,
      kind:         r.kind,
      directed:     r.directed,
      introducedAt: r.introducedAt,
      endedAt:      r.endedAt,
    }))

  return { series, characters, relationships, atUnit: clampedUnit }
}
