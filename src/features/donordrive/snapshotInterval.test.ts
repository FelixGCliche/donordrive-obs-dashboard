import { describe, expect, test } from 'bun:test'

import { getSnapshotRefetchInterval, MAX_BACKOFF_MS } from './snapshotInterval'
import type { SnapshotError } from './types'

const upstream: SnapshotError = { kind: 'upstream', message: 'down' }

describe('getSnapshotRefetchInterval', () => {
  test('uses the configured interval on success', () => {
    expect(getSnapshotRefetchInterval({ intervalSec: 30 })).toBe(30_000)
    expect(getSnapshotRefetchInterval({ intervalSec: 15, errorStreak: 0 })).toBe(15_000)
  })

  test('stops when paused', () => {
    expect(getSnapshotRefetchInterval({ intervalSec: 30, paused: true })).toBe(false)
    expect(
      getSnapshotRefetchInterval({
        intervalSec: 30,
        paused: true,
        lastError: upstream,
        errorStreak: 2,
      })
    ).toBe(false)
  })

  test('stops on not_found', () => {
    expect(
      getSnapshotRefetchInterval({
        intervalSec: 30,
        lastError: { kind: 'not_found', message: 'gone' },
        errorStreak: 1,
      })
    ).toBe(false)
  })

  test('backs off exponentially on errors, capped at 5 minutes', () => {
    const at = (errorStreak: number) =>
      getSnapshotRefetchInterval({ intervalSec: 15, lastError: upstream, errorStreak })
    expect([1, 2, 3, 4, 5].map(at)).toEqual([15_000, 30_000, 60_000, 120_000, 240_000])
    expect(at(6)).toBe(MAX_BACKOFF_MS)
    expect(at(500)).toBe(MAX_BACKOFF_MS)
    // A missing streak counts as one failure
    expect(getSnapshotRefetchInterval({ intervalSec: 15, lastError: upstream })).toBe(15_000)
  })

  test('waits at least Retry-After, even past the backoff cap', () => {
    const rateLimited = (retryAfterSec: number): SnapshotError => ({
      kind: 'rate_limited',
      message: 'slow down',
      retryAfterSec,
    })
    expect(
      getSnapshotRefetchInterval({ intervalSec: 15, lastError: rateLimited(90), errorStreak: 1 })
    ).toBe(90_000)
    expect(
      getSnapshotRefetchInterval({ intervalSec: 15, lastError: rateLimited(10), errorStreak: 3 })
    ).toBe(60_000)
    expect(
      getSnapshotRefetchInterval({ intervalSec: 15, lastError: rateLimited(3600), errorStreak: 1 })
    ).toBe(3_600_000)
  })

  test('schema errors back off too', () => {
    expect(
      getSnapshotRefetchInterval({
        intervalSec: 60,
        lastError: { kind: 'schema', message: 'bad' },
        errorStreak: 2,
      })
    ).toBe(120_000)
  })
})
