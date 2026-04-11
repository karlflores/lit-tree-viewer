import { describe, it, expect } from 'vitest'
import { getEdgeStyle } from '../lib/edgeStyles'
import type { RelationshipKind } from '../types/domain'

const ALL_KINDS: RelationshipKind[] = [
  'family', 'parent_child', 'romantic', 'ally', 'rival', 'enemy', 'mentor', 'other',
]

describe('getEdgeStyle', () => {
  it('returns a non-empty color and label for every relationship kind', () => {
    for (const kind of ALL_KINDS) {
      const style = getEdgeStyle(kind, kind)
      expect(style.color).toBeTruthy()
      expect(style.label).toBeTruthy()
    }
  })

  it('returns distinct colors for each kind', () => {
    const colors = ALL_KINDS.map(k => getEdgeStyle(k, k).color)
    const unique = new Set(colors)
    expect(unique.size).toBe(ALL_KINDS.length)
  })

  it('returns correct label for family', () => {
    expect(getEdgeStyle('family', 'family').label).toBe('Family')
  })

  it('returns correct label for parent_child', () => {
    expect(getEdgeStyle('parent_child', 'parent_child').label).toBe('Parent / Child')
  })

  it('returns correct label for enemy', () => {
    expect(getEdgeStyle('enemy', 'enemy').label).toBe('Enemy')
  })

  it('returns a valid hex color string', () => {
    for (const kind of ALL_KINDS) {
      expect(getEdgeStyle(kind, kind).color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('uses colours map when provided and label matches', () => {
    const colours = { rival: '#ff0000' }
    const style = getEdgeStyle('rival', 'rival', colours)
    expect(style.color).toBe('#ff0000')
    expect(style.label).toBe('rival')
  })

  it('falls back to kind when colours map does not contain the label', () => {
    const colours = { other_label: '#ff0000' }
    const style = getEdgeStyle('ally', 'ally', colours)
    expect(style.color).toBe('#a78bfa') // ally color from KIND_STYLES
    expect(style.label).toBe('Ally')
  })

  it('uses fallback color when kind is undefined and label not in colours map', () => {
    const style = getEdgeStyle(undefined, 'custom-label')
    expect(style.color).toBe('#94a3b8')
    expect(style.label).toBe('custom-label')
  })

  it('uses colours map with undefined kind for LTG-imported relationships', () => {
    const colours = { 'sworn enemies': '#ff0000' }
    const style = getEdgeStyle(undefined, 'sworn enemies', colours)
    expect(style.color).toBe('#ff0000')
    expect(style.label).toBe('sworn enemies')
  })
})
