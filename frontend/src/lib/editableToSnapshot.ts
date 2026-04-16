import type { GraphSnapshot } from '../types/domain'

/**
 * Filter a full `GraphSnapshot` (all characters/relationships across all time)
 * down to what is visible at `atUnit`.
 *
 * Mirrors the filtering logic in `compiledToSnapshot`:
 *   - Characters whose `introducedAt` > `atUnit` are excluded.
 *   - Relationships whose `introducedAt` > `atUnit` are excluded.
 *   - Relationships whose `endedAt` < `atUnit` are excluded.
 *   - Relationships referencing a character not present at `atUnit` are excluded.
 *   - `atUnit` is clamped to [1, totalUnits].
 */
export function editableToSnapshot(graph: GraphSnapshot, atUnit: number): GraphSnapshot {
  const clampedUnit = Math.min(Math.max(1, atUnit), graph.series.totalUnits)

  const characters = graph.characters
    .filter(c => c.introducedAt <= clampedUnit)

  const presentIds = new Set(characters.map(c => c.id))

  const relationships = graph.relationships
    .filter(r =>
      r.introducedAt <= clampedUnit &&
      (r.endedAt === null || r.endedAt >= clampedUnit) &&
      presentIds.has(r.fromId) &&
      presentIds.has(r.toId),
    )

  return { series: graph.series, characters, relationships, atUnit: clampedUnit }
}
