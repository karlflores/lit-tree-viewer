import { err, ok, type Result } from 'neverthrow'
import type { ApiError, GraphSnapshot, Series } from '../types/domain'
import type { CompileSuccess } from '../lib/ltgLspClient'
import type { ImportPayload } from '../lib/importPayload'

const BASE = '/api'

const request = async <T>(path: string): Promise<Result<T, ApiError>> => {
  try {
    const res = await fetch(`${BASE}${path}`)
    if (res.status === 404) return err({ kind: 'not_found' })
    if (!res.ok) return err({ kind: 'server', status: res.status })
    return ok((await res.json()) as T)
  } catch (e) {
    return err({ kind: 'network', message: String(e) })
  }
}

const mutate = async <T>(
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
): Promise<Result<T, ApiError>> => {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.status === 404) return err({ kind: 'not_found' })
    if (!res.ok) return err({ kind: 'server', status: res.status })
    const text = await res.text()
    return ok((text ? JSON.parse(text) : undefined) as T)
  } catch (e) {
    return err({ kind: 'network', message: String(e) })
  }
}

export const fetchAllSeries = (): Promise<Result<Series[], ApiError>> =>
  request<Series[]>('/series')

export const fetchSeries = (id: string): Promise<Result<Series, ApiError>> =>
  request<Series>(`/series/${id}`)

export const fetchGraphSnapshot = (
  seriesId: string,
  atUnit: number,
): Promise<Result<GraphSnapshot, ApiError>> =>
  request<GraphSnapshot>(`/series/${seriesId}/graph?at=${atUnit}`)

export const fetchFullGraph = (
  seriesId: string,
): Promise<Result<GraphSnapshot, ApiError>> =>
  request<GraphSnapshot>(`/series/${seriesId}/graph/full`)

export const fetchCompiledGraph = (
  seriesId: string,
): Promise<Result<CompileSuccess, ApiError>> =>
  request<CompileSuccess>(`/series/${seriesId}/compiled`)

/** Create a new series from a canvas-authored graph. Returns the server-assigned UUID. */
export const createGraph = (
  payload: ImportPayload,
): Promise<Result<{ id: string }, ApiError>> =>
  mutate<{ id: string }>('POST', '/series', payload)

/** Replace an existing series' characters and relationships in-place. */
export const patchGraph = (
  seriesId: string,
  payload: ImportPayload,
): Promise<Result<Series, ApiError>> =>
  mutate<Series>('PATCH', `/series/${seriesId}`, payload)
