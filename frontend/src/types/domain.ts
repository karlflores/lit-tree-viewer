// ============================================================
// Series
// ============================================================

export type MediaType = 'book' | 'show' | 'film'

/**
 * One organisational group (arc / volume / season) spanning a range of blocks.
 * `range` is inclusive: [firstBlockIndex, lastBlockIndex].
 */
export type BlockGroup = Readonly<{
  label: string
  range: readonly [number, number]
}>

export type Series = Readonly<{
  id: string
  title: string
  mediaType: MediaType
  unitLabel: string
  totalUnits: number
  // Optional metadata fields — sourced from LTG `metadata` / `set` directives
  author?: string
  groupType?: string
  // Arbitrary key-value metadata tags (LTG: `metadata <key>: "<value>"`)
  customMetadata?: Readonly<Record<string, string>>
  // Block display labels, e.g. { 3: "The Storm" }  →  `new chapter: "The Storm"`
  blockLabels?: Readonly<Record<number, string>>
  // Ordered group containers, e.g. [{ label: "Volume I", range: [2, 8] }]
  blockGroups?: readonly BlockGroup[]
}>

// ============================================================
// Characters
// ============================================================

export type CharacterState =
  | { readonly status: 'active' }
  | { readonly status: 'deceased'; readonly diedAt: number }

export type CharacterRename = Readonly<{
  name: string
  introducedAt: number
}>

export type Character = Readonly<{
  id: string
  seriesId: string
  name: string                          // effective display name at the queried unit (server-resolved)
  aliases: readonly string[]
  renames?: readonly CharacterRename[]  // history up to the queried unit; absent if no renames
  description: string | null
  imageUrl: string | null
  introducedAt: number
  diedAt: number | null
  ltgIdentifier?: string                // present only for LTG-imported characters
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
  kind?: RelationshipKind   // absent for LTG-imported relationships; use label for styling
  label: string             // canonical identifier; always present after migration 002
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
  colours?: Readonly<Record<string, string>>
}>

// ============================================================
// API Error
// ============================================================

export type ApiError =
  | { readonly kind: 'network'; readonly message: string }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'server'; readonly status: number }
