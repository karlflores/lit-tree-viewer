import type { MediaType, RelationshipKind } from './domain'

// ---------------------------------------------------------------------------
// EditableGraph — frontend-only graph representation for the canvas editor.
//
// Lives in sessionStorage until a backend endpoint is wired up.
// IDs are prefixed strings built from crypto.randomUUID() so they are globally
// unique but clearly distinct from real backend UUIDs.
// ---------------------------------------------------------------------------

export type EditableCharacter = Readonly<{
  id:           string          // 'char:<uuid>'
  name:         string
  aliases:      readonly string[]
  description:  string | null
  imageUrl:     string | null
  introducedAt: number          // chapter/episode this character was added
  diedAt:       number | null
}>

export type EditableRelationship = Readonly<{
  id:           string          // 'rel:<uuid>'
  fromId:       string          // EditableCharacter.id
  toId:         string          // EditableCharacter.id
  label:        string
  kind?:        RelationshipKind
  directed:     boolean
  introducedAt: number
  endedAt:      number | null
}>

export type EditableGraph = Readonly<{
  id:            string         // 'edit:<uuid>'
  title:         string
  mediaType:     MediaType
  unitLabel:     string         // 'Chapter' | 'Episode' | 'Part'
  totalUnits:    number         // grows as chapters are added
  characters:    readonly EditableCharacter[]
  relationships: readonly EditableRelationship[]
}>
