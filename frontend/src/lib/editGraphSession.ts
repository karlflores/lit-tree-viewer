import type { EditableGraph } from '../types/editGraph'

const SESSION_KEY = 'litree:edit-graph'

/** Create a blank graph ready for canvas authoring. */
export function createEmptyGraph(): EditableGraph {
  return {
    id:            `edit:${crypto.randomUUID()}`,
    title:         'Untitled',
    mediaType:     'book',
    unitLabel:     'Chapter',
    totalUnits:    1,
    characters:    [],
    relationships: [],
  }
}

/** Persist the current edit graph to sessionStorage. */
export function saveEditGraph(graph: EditableGraph): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(graph))
  } catch {
    // sessionStorage may be unavailable (private browsing quota exceeded, etc.)
  }
}

/**
 * Load a previously saved edit graph from sessionStorage.
 * Returns null if nothing is stored or the data cannot be parsed.
 */
export function loadEditGraph(): EditableGraph | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as EditableGraph
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
