// ============================================================
// Series
// ============================================================

export type MediaType = 'book' | 'show' | 'film'

export type Series = Readonly<{
  id: string
  title: string
  mediaType: MediaType
  unitLabel: string
  totalUnits: number
}>

// ============================================================
// Characters
// ============================================================

export type CharacterState =
  | { readonly status: 'active' }
  | { readonly status: 'deceased'; readonly diedAt: number }

export type Character = Readonly<{
  id: string
  seriesId: string
  name: string
  aliases: readonly string[]
  description: string | null
  imageUrl: string | null
  introducedAt: number
  diedAt: number | null
}>

export const getCharacterState = (character: Character, atUnit: number): CharacterState => {
  if (character.diedAt !== null && character.diedAt <= atUnit) {
    return { status: 'deceased', diedAt: character.diedAt }
  }
  return { status: 'active' }
}

export const getInitials = (name: string): string =>
  name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0] ?? '')
    .join('')
    .toUpperCase()

// ============================================================
// Relationships
// ============================================================

export type RelationshipKind =
  | 'family'
  | 'parent_child'
  | 'romantic'
  | 'ally'
  | 'rival'
  | 'enemy'
  | 'mentor'
  | 'other'

export type Relationship = Readonly<{
  id: string
  seriesId: string
  fromId: string
  toId: string
  kind: RelationshipKind
  label: string | null
  directed: boolean
  introducedAt: number
  endedAt: number | null
}>

// ============================================================
// Graph Snapshot
// ============================================================

export type GraphSnapshot = Readonly<{
  series: Series
  characters: readonly Character[]
  relationships: readonly Relationship[]
  atUnit: number
}>

// ============================================================
// API Error
// ============================================================

export type ApiError =
  | { readonly kind: 'network'; readonly message: string }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'server'; readonly status: number }
