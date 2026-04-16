import { useQuery } from '@tanstack/react-query'
import { fetchCompiledGraph } from '../api/client'
import type { ApiError } from '../types/domain'
import type { CompileSuccess } from '../lib/ltgLspClient'
import type { Result } from 'neverthrow'

type CompiledGraphState =
  | { status: 'loading' }
  | { status: 'error';   error: ApiError }
  | { status: 'success'; graph: CompileSuccess }

/**
 * Eagerly fetches the compiled graph for a series and caches it indefinitely.
 * Used by "Open in Editor" so the LTG source is available instantly without
 * a network round-trip on button click.
 */
export const useCompiledGraph = (seriesId: string): CompiledGraphState => {
  const { data: result, isLoading } = useQuery({
    queryKey: ['compiled', seriesId] as const,
    queryFn:  (): Promise<Result<CompileSuccess, ApiError>> => fetchCompiledGraph(seriesId),
    staleTime: Infinity,
  })

  if (isLoading && !result) return { status: 'loading' }
  if (!result || result.isErr()) return { status: 'error', error: result?.error ?? { kind: 'network', message: 'Unknown error' } }
  return { status: 'success', graph: result.value }
}
