import { err, ok, type Result } from 'neverthrow'
import type { ApiError, GraphSnapshot, Series } from '../types/domain'

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

export const fetchAllSeries = (): Promise<Result<Series[], ApiError>> =>
  request<Series[]>('/series')

export const fetchSeries = (id: string): Promise<Result<Series, ApiError>> =>
  request<Series>(`/series/${id}`)

export const fetchGraphSnapshot = (
  seriesId: string,
  atUnit: number,
): Promise<Result<GraphSnapshot, ApiError>> =>
  request<GraphSnapshot>(`/series/${seriesId}/graph?at=${atUnit}`)
