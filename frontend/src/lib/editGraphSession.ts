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

// ---------------------------------------------------------------------------
// Viewer graph — the last explicitly saved graph shown in viewer mode.
// Persisted to localStorage so it survives a page refresh.
// ---------------------------------------------------------------------------

const VIEWER_KEY = 'litree:viewer-graph'

/** Persist the viewer graph to localStorage. */
export function saveViewerGraph(graph: GraphSnapshot): void {
  try {
    localStorage.setItem(VIEWER_KEY, JSON.stringify(graph))
  } catch {
    // ignore
  }
}

/**
 * Load the viewer graph from localStorage.
 * Returns null if nothing is stored or the data is invalid.
 */
export function loadViewerGraph(): GraphSnapshot | null {
  try {
    const raw = localStorage.getItem(VIEWER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !parsed.series) {
      localStorage.removeItem(VIEWER_KEY)
      return null
    }
    return parsed as GraphSnapshot
  } catch {
    return null
  }
}
