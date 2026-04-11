import { describe, it, expect } from 'vitest'
import { getCharacterState, getInitials, type Character } from '../types/domain'

const baseCharacter: Character = {
  id: 'c1',
  seriesId: 's1',
  name: 'Edmond Dantès',
  aliases: [],
  description: null,
  imageUrl: null,
  introducedAt: 1,
  diedAt: null,
}

describe('getCharacterState', () => {
  it('returns active when character has no diedAt', () => {
    const state = getCharacterState(baseCharacter, 10)
    expect(state.status).toBe('active')
  })

  it('returns active when diedAt is after the current unit', () => {
    const character: Character = { ...baseCharacter, diedAt: 20 }
    const state = getCharacterState(character, 15)
    expect(state.status).toBe('active')
  })

  it('returns deceased when diedAt equals the current unit', () => {
    const character: Character = { ...baseCharacter, diedAt: 10 }
    const state = getCharacterState(character, 10)
    expect(state.status).toBe('deceased')
    if (state.status === 'deceased') {
      expect(state.diedAt).toBe(10)
    }
  })

  it('returns deceased when diedAt is before the current unit', () => {
    const character: Character = { ...baseCharacter, diedAt: 5 }
    const state = getCharacterState(character, 10)
    expect(state.status).toBe('deceased')
    if (state.status === 'deceased') {
      expect(state.diedAt).toBe(5)
    }
  })
})

describe('getInitials', () => {
  it('returns initials from first two words', () => {
    expect(getInitials('Edmond Dantès')).toBe('ED')
  })

  it('returns a single initial for a one-word name', () => {
    expect(getInitials('Mercedes')).toBe('M')
  })

  it('only uses the first two words when there are more', () => {
    expect(getInitials('The Count of Monte Cristo')).toBe('TC')
  })

  it('returns uppercase initials', () => {
    expect(getInitials('albert de morcerf')).toBe('AD')
  })

  it('handles a name with a single character word', () => {
    expect(getInitials('J Villefort')).toBe('JV')
  })
})
