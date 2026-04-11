import type { RelationshipKind } from '../types/domain'

export type EdgeStyle = Readonly<{
  color: string
  strokeDasharray?: string
  label: string
}>

// Legacy kind → style map used for seed-data series.
// LTG-imported series supply their own colours map via series_colours.
const KIND_STYLES: Record<RelationshipKind, EdgeStyle> = {
  family:       { color: '#60a5fa', label: 'Family' },
  parent_child: { color: '#34d399', label: 'Parent / Child' },
  romantic:     { color: '#f472b6', label: 'Romantic' },
  ally:         { color: '#a78bfa', label: 'Ally' },
  rival:        { color: '#fb923c', label: 'Rival' },
  enemy:        { color: '#f87171', label: 'Enemy' },
  mentor:       { color: '#facc15', label: 'Mentor' },
  other:        { color: '#94a3b8', label: 'Other' },
}

/**
 * Returns the edge style for a relationship.
 *
 * @param kind    - Legacy enum value; present for seed-data series, absent for LTG-imported ones.
 * @param label   - Canonical relationship label; used when a colours map is supplied.
 * @param colours - Optional label→hex map from series_colours (LTG-imported series).
 */
export const getEdgeStyle = (
  kind: RelationshipKind | undefined,
  label: string,
  colours?: Readonly<Record<string, string>>,
): EdgeStyle => {
  // LTG series: use the colours map from the backend
  if (colours) {
    const hex = colours[label]
    if (hex) return { color: hex, label }
  }
  // Legacy seed-data series: fall back to kind enum
  if (kind) return KIND_STYLES[kind]
  // Absolute fallback (e.g. label not in colours map)
  return { color: '#94a3b8', label }
}
