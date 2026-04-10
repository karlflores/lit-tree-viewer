type Position = { x: number; y: number }
type PositionMap = Record<string, Position>

const storageKey = (seriesId: string) => `litree:positions:${seriesId}`

/** Load all saved node positions for a series from localStorage. */
export const loadPositions = (seriesId: string): Map<string, Position> => {
  try {
    const raw = localStorage.getItem(storageKey(seriesId))
    if (!raw) return new Map()
    return new Map(Object.entries(JSON.parse(raw) as PositionMap))
  } catch {
    return new Map()
  }
}

/** Persist a single node's position to localStorage. */
export const savePosition = (seriesId: string, nodeId: string, position: Position): void => {
  try {
    const key = storageKey(seriesId)
    const existing = JSON.parse(localStorage.getItem(key) ?? '{}') as PositionMap
    localStorage.setItem(key, JSON.stringify({ ...existing, [nodeId]: position }))
  } catch {
    // localStorage may be full or unavailable — silently ignore
  }
}
