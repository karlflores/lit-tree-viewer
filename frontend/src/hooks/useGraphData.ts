import { useEffect } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchGraphSnapshot } from '../api/client'
import type { GraphSnapshot, ApiError } from '../types/domain'
import type { Result } from 'neverthrow'

type GraphDataState =
  | { status: 'loading' }
  | { status: 'error';   error: ApiError }
  | { status: 'success'; snapshot: GraphSnapshot }

const queryKey = (seriesId: string, unit: number) =>
  ['graph', seriesId, unit] as const

const queryFn = (seriesId: string, unit: number) =>
  (): Promise<Result<GraphSnapshot, ApiError>> =>
    fetchGraphSnapshot(seriesId, unit)

/**
 * Fetches the graph snapshot for a given series and unit (chapter/episode).
 *
 * On first successful load, eagerly prefetches all remaining units in the
 * background so subsequent scrubs are served instantly from cache.
 */
export const useGraphData = (seriesId: string, currentUnit: number): GraphDataState => {
  const queryClient = useQueryClient()

  const { data: result, isLoading } = useQuery({
    queryKey: queryKey(seriesId, currentUnit),
    queryFn:  queryFn(seriesId, currentUnit),
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  })

  const totalUnits = result?.isOk() ? result.value.series.totalUnits : null

  useEffect(() => {
    if (!totalUnits) return
    for (let unit = 1; unit <= totalUnits; unit++) {
      queryClient.prefetchQuery({
        queryKey: queryKey(seriesId, unit),
        queryFn:  queryFn(seriesId, unit),
        staleTime: Infinity,
      })
    }
  }, [queryClient, seriesId, totalUnits])

  if (isLoading && !result) return { status: 'loading' }
  if (!result || result.isErr()) return { status: 'error', error: result?.error ?? { kind: 'network', message: 'Unknown error' } }
  return { status: 'success', snapshot: result.value }
}
