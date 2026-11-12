import { keepPreviousData, queryOptions, skipToken, useQuery } from '@tanstack/react-query'

import { getSnapshot } from './getSnapshot'
import { getSnapshotRefetchInterval } from './snapshotInterval'
import type { DonorDriveHost, Snapshot, SnapshotError, SnapshotResult } from './types'

export type SnapshotQueryParams = {
  host: DonorDriveHost
  /** Polling is disabled until a pid is set */
  pid?: string
  /** Poll interval, in seconds */
  interval: number
  paused?: boolean
}

export type SnapshotQueryData = {
  /** Result of the latest poll */
  result: SnapshotResult
  /** Latest successful snapshot for this host and pid; kept while polls fail */
  snapshot?: Snapshot
  /** Error of the latest poll, if it failed */
  error?: SnapshotError
  /** Consecutive failed polls, 0 after a success */
  errorStreak: number
}

export const snapshotQueryKey = (host: DonorDriveHost, pid: string | undefined) =>
  ['donordrive', 'snapshot', host, pid ?? null] as const

const THROWN_ERROR: SnapshotError = { kind: 'upstream', message: 'Could not reach the server' }

export const snapshotQueryOptions = ({ host, pid, interval, paused }: SnapshotQueryParams) => {
  const queryKey = snapshotQueryKey(host, pid)

  return queryOptions({
    queryKey,
    queryFn: pid
      ? async ({ client }): Promise<SnapshotQueryData> => {
          const previous = client.getQueryData<SnapshotQueryData>(queryKey)
          const result = await getSnapshot({ data: { host, pid } })
          return result.ok
            ? { result, snapshot: result.snapshot, errorStreak: 0 }
            : {
                result,
                snapshot: previous?.snapshot,
                error: result.error,
                errorStreak: (previous?.errorStreak ?? 0) + 1,
              }
        }
      : skipToken,
    enabled: Boolean(pid),
    // Polling and backoff below replace retries
    retry: false,
    refetchIntervalInBackground: true,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const { data, status, fetchFailureCount } = query.state
      // A thrown error (server unreachable, invalid input) also backs off
      const thrown = status === 'error'
      return getSnapshotRefetchInterval({
        intervalSec: interval,
        paused,
        lastError: thrown ? THROWN_ERROR : data?.error,
        errorStreak: thrown ? fetchFailureCount : data?.errorStreak,
      })
    },
  })
}

/**
 * Polls the DonorDrive snapshot for a participant through `getSnapshot`.
 * `data.snapshot` keeps the last good snapshot while `data.error` reports the latest failure.
 */
export const useSnapshotQuery = (params: SnapshotQueryParams) =>
  useQuery(snapshotQueryOptions(params))
