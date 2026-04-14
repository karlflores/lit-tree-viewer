import type { GraphSnapshot, Series } from '../types/domain'

const SESSION_KEY = 'litree:edit-graph'

/** Create a blank graph ready for canvas authoring. */
export function createEmptyGraph(): GraphSnapshot {
  const id: string = `edit:${crypto.randomUUID()}`
  const series: Series = {
    id,
    title:      'Untitled',
    mediaType:  'book',
    unitLabel:  'Chapter',
    totalUnits: 1,
  }
  return { series, characters: [], relationships: [], atUnit: 1 }
}

/** Persist the current edit graph to sessionStorage. */
export function saveEditGraph(graph: GraphSnapshot): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(graph))
  } catch {
    // sessionStorage may be unavailable (private browsing quota exceeded, etc.)
  }
}

/**
 * Load a previously saved edit graph from sessionStorage.
 * Returns null if nothing is stored, the data cannot be parsed, or the stored
 * data is in a stale format (e.g. from before the GraphSnapshot refactor).
 */
export function loadEditGraph(): GraphSnapshot | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    // Validate the expected shape — discard stale pre-refactor data.
    if (!parsed || typeof parsed !== 'object' || !parsed.series) {
      sessionStorage.removeItem(SESSION_KEY)
      return null
    }
    return parsed as GraphSnapshot
  } catch {
    return null
  }
}

/** Remove the saved edit graph from sessionStorage. */
export function clearEditGraph(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // ignore
  }
}
