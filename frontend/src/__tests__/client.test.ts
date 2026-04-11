import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchAllSeries, fetchSeries, fetchGraphSnapshot } from '../api/client'
import type { Series, GraphSnapshot } from '../types/domain'

const mockSeries: Series = {
  id: 's1',
  title: 'The Count of Monte Cristo',
  mediaType: 'book',
  unitLabel: 'Chapter',
  totalUnits: 117,
}

const mockSnapshot: GraphSnapshot = {
  series: mockSeries,
  characters: [],
  relationships: [],
  atUnit: 5,
}

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }))
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('fetchAllSeries', () => {
  it('returns ok with series list on 200', async () => {
    mockFetch(200, [mockSeries])
    const result = await fetchAllSeries()
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual([mockSeries])
  })

  it('calls the correct endpoint', async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve([]) })
    vi.stubGlobal('fetch', spy)
    await fetchAllSeries()
    expect(spy).toHaveBeenCalledWith('/api/series')
  })

  it('returns a not_found error on 404', async () => {
    mockFetch(404, null)
    const result = await fetchAllSeries()
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'not_found' })
  })

  it('returns a server error on 500', async () => {
    mockFetch(500, null)
    const result = await fetchAllSeries()
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'server', status: 500 })
  })

  it('returns a network error when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')))
    const result = await fetchAllSeries()
    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error.kind).toBe('network')
  })
})

describe('fetchSeries', () => {
  it('returns ok with the series on 200', async () => {
    mockFetch(200, mockSeries)
    const result = await fetchSeries('s1')
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual(mockSeries)
  })

  it('calls the correct endpoint', async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(mockSeries) })
    vi.stubGlobal('fetch', spy)
    await fetchSeries('s1')
    expect(spy).toHaveBeenCalledWith('/api/series/s1')
  })

  it('returns not_found on 404', async () => {
    mockFetch(404, null)
    const result = await fetchSeries('missing')
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'not_found' })
  })
})

describe('fetchGraphSnapshot', () => {
  it('returns ok with the snapshot on 200', async () => {
    mockFetch(200, mockSnapshot)
    const result = await fetchGraphSnapshot('s1', 5)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual(mockSnapshot)
  })

  it('calls the correct endpoint with the unit query param', async () => {
    const spy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(mockSnapshot) })
    vi.stubGlobal('fetch', spy)
    await fetchGraphSnapshot('s1', 10)
    expect(spy).toHaveBeenCalledWith('/api/series/s1/graph?at=10')
  })

  it('returns a server error on 503', async () => {
    mockFetch(503, null)
    const result = await fetchGraphSnapshot('s1', 1)
    expect(result._unsafeUnwrapErr()).toEqual({ kind: 'server', status: 503 })
  })
})
