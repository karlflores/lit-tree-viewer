import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadPositions, savePosition } from '../lib/nodePositions'

// jsdom's localStorage may not be a full Storage instance, so we mock it.
const store: Record<string, string> = {}
const localStorageMock = {
  getItem:    (key: string) => store[key] ?? null,
  setItem:    (key: string, val: string) => { store[key] = val },
  removeItem: (key: string) => { delete store[key] },
  clear:      () => { Object.keys(store).forEach(k => delete store[k]) },
}
vi.stubGlobal('localStorage', localStorageMock)

beforeEach(() => {
  localStorageMock.clear()
})

describe('loadPositions', () => {
  it('returns an empty map when nothing is stored', () => {
    const result = loadPositions('series-1')
    expect(result.size).toBe(0)
  })

  it('returns stored positions', () => {
    localStorage.setItem(
      'litree:positions:series-1',
      JSON.stringify({ node1: { x: 10, y: 20 } }),
    )
    const result = loadPositions('series-1')
    expect(result.get('node1')).toEqual({ x: 10, y: 20 })
  })

  it('returns an empty map when stored JSON is invalid', () => {
    localStorage.setItem('litree:positions:series-1', '{not valid json}')
    const result = loadPositions('series-1')
    expect(result.size).toBe(0)
  })

  it('isolates positions by seriesId', () => {
    localStorage.setItem(
      'litree:positions:series-A',
      JSON.stringify({ n1: { x: 1, y: 2 } }),
    )
    const result = loadPositions('series-B')
    expect(result.size).toBe(0)
  })
})

describe('savePosition', () => {
  it('persists a node position', () => {
    savePosition('series-1', 'node1', { x: 5, y: 15 })
    const result = loadPositions('series-1')
    expect(result.get('node1')).toEqual({ x: 5, y: 15 })
  })

  it('merges with existing positions without overwriting others', () => {
    savePosition('series-1', 'node1', { x: 1, y: 2 })
    savePosition('series-1', 'node2', { x: 3, y: 4 })
    const result = loadPositions('series-1')
    expect(result.get('node1')).toEqual({ x: 1, y: 2 })
    expect(result.get('node2')).toEqual({ x: 3, y: 4 })
  })

  it('overwrites an existing node position', () => {
    savePosition('series-1', 'node1', { x: 1, y: 2 })
    savePosition('series-1', 'node1', { x: 99, y: 100 })
    const result = loadPositions('series-1')
    expect(result.get('node1')).toEqual({ x: 99, y: 100 })
  })

  it('does not write to the wrong series key', () => {
    savePosition('series-A', 'node1', { x: 1, y: 1 })
    expect(loadPositions('series-B').size).toBe(0)
  })
})
