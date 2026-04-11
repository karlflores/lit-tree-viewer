import { describe, it, expect } from 'vitest'
import { getEdgeStyle } from '../lib/edgeStyles'
import type { RelationshipKind } from '../types/domain'

const ALL_KINDS: RelationshipKind[] = [
  'family', 'parent_child', 'romantic', 'ally', 'rival', 'enemy', 'mentor', 'other',
]

describe('getEdgeStyle', () => {
  it('returns a non-empty color and label for every relationship kind', () => {
    for (const kind of ALL_KINDS) {
      const style = getEdgeStyle(kind)
      expect(style.color).toBeTruthy()
      expect(style.label).toBeTruthy()
    }
  })

  it('returns distinct colors for each kind', () => {
    const colors = ALL_KINDS.map(k => getEdgeStyle(k).color)
    const unique = new Set(colors)
    expect(unique.size).toBe(ALL_KINDS.length)
  })

  it('returns correct label for family', () => {
    expect(getEdgeStyle('family').label).toBe('Family')
  })

  it('returns correct label for parent_child', () => {
    expect(getEdgeStyle('parent_child').label).toBe('Parent / Child')
  })

  it('returns correct label for enemy', () => {
    expect(getEdgeStyle('enemy').label).toBe('Enemy')
  })

  it('returns a valid hex color string', () => {
    for (const kind of ALL_KINDS) {
      expect(getEdgeStyle(kind).color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})
