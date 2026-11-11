import type { SnapshotError } from './types'

/** Longest wait between polls while backing off */
export const MAX_BACKOFF_MS = 5 * 60 * 1000

export type SnapshotIntervalInput = {
  /** Configured poll interval, in seconds */
  intervalSec: number
  paused?: boolean
  /** Error of the latest poll, if it failed */
  lastError?: SnapshotError
  /** Number of consecutive failed polls, including the latest */
  errorStreak?: number
}

/**
 * Milliseconds until the next poll, or `false` to stop polling.
 * - paused, or the participant doesn't exist: stop;
 * - success: the configured interval;
 * - errors: the interval doubled per consecutive failure, at least Retry-After,
 *   capped at 5 minutes.
 */
export const getSnapshotRefetchInterval = ({
  intervalSec,
  paused = false,
  lastError,
  errorStreak = 0,
}: SnapshotIntervalInput): number | false => {
  if (paused) return false
  const base = Math.max(1, intervalSec) * 1000
  if (!lastError) return base
  if (lastError.kind === 'not_found') return false

  const exponent = Math.min(Math.max(errorStreak, 1) - 1, 20)
  const backoff = base * 2 ** exponent
  const retryAfter = (lastError.retryAfterSec ?? 0) * 1000
  return Math.min(MAX_BACKOFF_MS, Math.max(backoff, retryAfter))
}
