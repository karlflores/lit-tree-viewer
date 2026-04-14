import { describe, it, expect } from 'vitest'
import { editableToSnapshot } from '../lib/editableToSnapshot'
import type { GraphSnapshot, Character, Relationship, Series } from '../types/domain'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SERIES_ID = 'edit:test-id'

const series: Series = {
  id:         SERIES_ID,
  title:      'Test Series',
  mediaType:  'book',
  unitLabel:  'Chapter',
  totalUnits: 10,
}

const baseGraph: GraphSnapshot = {
  series,
  characters:    [],
  relationships: [],
  atUnit:        10,
}

const charA: Character = {
  id:           'char:a',
  seriesId:     SERIES_ID,
  name:         'Alice',
  aliases:      [],
  description:  null,
  imageUrl:     null,
  introducedAt: 1,
  diedAt:       null,
}

const charB: Character = {
  id:           'char:b',
  seriesId:     SERIES_ID,
  name:         'Bob',
  aliases:      [],
  description:  null,
  imageUrl:     null,
  introducedAt: 3,
  diedAt:       null,
}

const charC: Character = {
  id:           'char:c',
  seriesId:     SERIES_ID,
  name:         'Carol',
  aliases:      [],
  description:  null,
  imageUrl:     null,
  introducedAt: 5,
  diedAt:       7,
}

const rel: Relationship = {
  id:           'rel:ab',
  seriesId:     SERIES_ID,
  fromId:       'char:a',
  toId:         'char:b',
  label:        'ally',
  directed:     false,
  introducedAt: 3,
  endedAt:      null,
}

// ---------------------------------------------------------------------------
// Series mapping
// ---------------------------------------------------------------------------

describe('series fields', () => {
  it('maps all series fields correctly', () => {
    const snap = editableToSnapshot(baseGraph, 1)
    expect(snap.series).toEqual({
      id:         SERIES_ID,
      title:      'Test Series',
      mediaType:  'book',
      unitLabel:  'Chapter',
      totalUnits: 10,
    })
  })

  it('sets atUnit to the clamped value', () => {
    expect(editableToSnapshot(baseGraph, 5).atUnit).toBe(5)
  })

  it('does not include a colours map', () => {
    expect(editableToSnapshot(baseGraph, 1).colours).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// atUnit clamping
// ---------------------------------------------------------------------------

describe('atUnit clamping', () => {
  it('clamps atUnit below 1 to 1', () => {
    expect(editableToSnapshot(baseGraph, 0).atUnit).toBe(1)
    expect(editableToSnapshot(baseGraph, -5).atUnit).toBe(1)
  })

  it('clamps atUnit above totalUnits to totalUnits', () => {
    expect(editableToSnapshot(baseGraph, 99).atUnit).toBe(10)
  })

  it('accepts atUnit exactly equal to totalUnits', () => {
    expect(editableToSnapshot(baseGraph, 10).atUnit).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// Character filtering
// ---------------------------------------------------------------------------

describe('character filtering', () => {
  const graph: GraphSnapshot = { ...baseGraph, characters: [charA, charB, charC] }

  it('returns an empty array for an empty graph', () => {
    expect(editableToSnapshot(baseGraph, 5).characters).toHaveLength(0)
  })

  it('includes characters whose introducedAt <= atUnit', () => {
    const snap = editableToSnapshot(graph, 3)
    const ids = snap.characters.map(c => c.id)
    expect(ids).toContain('char:a')
    expect(ids).toContain('char:b')
  })

  it('excludes characters whose introducedAt > atUnit', () => {
    const snap = editableToSnapshot(graph, 2)
    const ids = snap.characters.map(c => c.id)
    expect(ids).not.toContain('char:b')
    expect(ids).not.toContain('char:c')
  })

  it('preserves diedAt without filtering deceased characters out', () => {
    // Characters remain in the snapshot even after their diedAt — the node
    // rendering decides whether to display them as deceased based on atUnit.
    const snap = editableToSnapshot(graph, 8)
    const carol = snap.characters.find(c => c.id === 'char:c')
    expect(carol).toBeDefined()
    expect(carol!.diedAt).toBe(7)
  })

  it('maps character fields to the domain Character type', () => {
    const snap = editableToSnapshot(graph, 1)
    const alice = snap.characters[0]!
    expect(alice.id).toBe('char:a')
    expect(alice.seriesId).toBe(SERIES_ID)
    expect(alice.name).toBe('Alice')
    expect(alice.aliases).toEqual([])
    expect(alice.description).toBeNull()
    expect(alice.imageUrl).toBeNull()
    expect(alice.introducedAt).toBe(1)
    expect(alice.diedAt).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Relationship filtering
// ---------------------------------------------------------------------------

describe('relationship filtering', () => {
  const graph: GraphSnapshot = {
    ...baseGraph,
    characters:    [charA, charB, charC],
    relationships: [rel],
  }

  it('returns an empty array when no relationships exist', () => {
    expect(editableToSnapshot(baseGraph, 5).relationships).toHaveLength(0)
  })

  it('includes relationships whose introducedAt <= atUnit', () => {
    const snap = editableToSnapshot(graph, 3)
    expect(snap.relationships).toHaveLength(1)
    expect(snap.relationships[0]!.id).toBe('rel:ab')
  })

  it('excludes relationships whose introducedAt > atUnit', () => {
    const snap = editableToSnapshot(graph, 2)
    expect(snap.relationships).toHaveLength(0)
  })

  it('excludes relationships whose endedAt < atUnit', () => {
    const endedRel: Relationship = { ...rel, id: 'rel:ended', endedAt: 4 }
    const g: GraphSnapshot = { ...graph, relationships: [endedRel] }
    expect(editableToSnapshot(g, 5).relationships).toHaveLength(0)
  })

  it('includes relationships whose endedAt === atUnit', () => {
    const endedRel: Relationship = { ...rel, id: 'rel:ended', endedAt: 5 }
    const g: GraphSnapshot = { ...graph, relationships: [endedRel] }
    expect(editableToSnapshot(g, 5).relationships).toHaveLength(1)
  })

  it('excludes relationships where either endpoint is not yet introduced', () => {
    // charB introducedAt=3; at unit 1 charB is absent so rel:ab is excluded
    const snap = editableToSnapshot(graph, 1)
    expect(snap.relationships).toHaveLength(0)
  })

  it('maps relationship fields to the domain Relationship type', () => {
    const snap = editableToSnapshot(graph, 5)
    const r = snap.relationships[0]!
    expect(r.id).toBe('rel:ab')
    expect(r.seriesId).toBe(SERIES_ID)
    expect(r.fromId).toBe('char:a')
    expect(r.toId).toBe('char:b')
    expect(r.label).toBe('ally')
    expect(r.directed).toBe(false)
    expect(r.introducedAt).toBe(3)
    expect(r.endedAt).toBeNull()
  })

  it('propagates optional kind field', () => {
    const kindRel: Relationship = { ...rel, kind: 'ally' }
    const g: GraphSnapshot = { ...graph, relationships: [kindRel] }
    const snap = editableToSnapshot(g, 5)
    expect(snap.relationships[0]!.kind).toBe('ally')
  })

  it('omits kind when not set on the relationship', () => {
    const snap = editableToSnapshot(graph, 5)
    expect(snap.relationships[0]!.kind).toBeUndefined()
  })
})
