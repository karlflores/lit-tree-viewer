import { useQuery } from '@tanstack/react-query'
import { fetchFullGraph } from '../api/client'
import type { GraphSnapshot, ApiError } from '../types/domain'
import type { Result } from 'neverthrow'

type FullGraphState =
  | { status: 'loading' }
  | { status: 'error';   error: ApiError }
  | { status: 'success'; snapshot: GraphSnapshot }

/**
 * Fetches the complete graph for a series — all characters and all
 * relationships with no temporal filtering. Used for layout calculations
 * and as the base for entering edit mode.
 *
 * Unlike `useGraphData`, this query has no `atUnit` dependency and is
 * fetched once then cached indefinitely.
 */
export const useFullGraph = (seriesId: string): FullGraphState => {
  const { data: result, isLoading } = useQuery({
    queryKey: ['graph-full', seriesId] as const,
    queryFn:  (): Promise<Result<GraphSnapshot, ApiError>> => fetchFullGraph(seriesId),
    staleTime: Infinity,
  })

  if (isLoading && !result) return { status: 'loading' }
  if (!result || result.isErr()) return { status: 'error', error: result?.error ?? { kind: 'network', message: 'Unknown error' } }
  return { status: 'success', snapshot: result.value }
}
