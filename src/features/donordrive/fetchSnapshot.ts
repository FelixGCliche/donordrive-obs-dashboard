import { buildParticipantUrl } from './hosts'
import { parseSnapshot } from './schemas'
import type { DonorDriveHost, SnapshotError, SnapshotResult } from './types'

export const SNAPSHOT_CACHE_TTL_MS = 15_000
export const SNAPSHOT_TIMEOUT_MS = 8_000
// MVP-SHORTCUT(MVP-07): only the latest page of donations (limit 50); older donations are never paged
export const SNAPSHOT_DONATIONS_LIMIT = 50
/** Used when a 429 has no usable Retry-After */
export const DEFAULT_RETRY_AFTER_SEC = 60
const MAX_RETRY_AFTER_SEC = 3600
const CACHE_PRUNE_SIZE = 200

export const DONORDRIVE_USER_AGENT = 'donordrive-obs-dock/0.1'

export type FetchSnapshotInput = { host: DonorDriveHost; pid: string }

type CacheEntry = { result: SnapshotResult; expiresAt: number }

// MVP-SHORTCUT(MVP-06): each poll fetches 3 endpoints, cached per isolate (not shared across isolates)
const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<SnapshotResult>>()

/** Test helper: forgets cached and in-flight snapshots */
export const clearSnapshotCache = () => {
  cache.clear()
  inFlight.clear()
}

/** Parses Retry-After (delta seconds or an HTTP date) into whole seconds */
export const parseRetryAfter = (value: string | null, now: number = Date.now()) => {
  if (!value) return undefined
  const trimmed = value.trim()
  const seconds = /^\d+$/.test(trimmed) ? Number(trimmed) : (Date.parse(trimmed) - now) / 1000
  if (!Number.isFinite(seconds)) return undefined
  return Math.min(MAX_RETRY_AFTER_SEC, Math.max(1, Math.ceil(seconds)))
}

type FetchJsonResult = { ok: true; data: unknown } | { ok: false; error: SnapshotError }

const fetchJson = async (url: string, signal: AbortSignal): Promise<FetchJsonResult> => {
  let response: Response
  try {
    response = await fetch(url, {
      signal,
      headers: { Accept: 'application/json', 'User-Agent': DONORDRIVE_USER_AGENT },
    })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return {
      ok: false,
      error: {
        kind: 'upstream',
        message: timedOut ? 'DonorDrive did not respond in time' : 'Could not reach DonorDrive',
      },
    }
  }

  if (response.status === 404) {
    return { ok: false, error: { kind: 'not_found', message: 'Participant not found' } }
  }
  if (response.status === 429) {
    return {
      ok: false,
      error: {
        kind: 'rate_limited',
        message: 'DonorDrive rate limit reached',
        retryAfterSec:
          parseRetryAfter(response.headers.get('Retry-After')) ?? DEFAULT_RETRY_AFTER_SEC,
      },
    }
  }
  if (!response.ok) {
    return {
      ok: false,
      error: { kind: 'upstream', message: `DonorDrive responded with ${response.status}` },
    }
  }

  try {
    return { ok: true, data: await response.json() }
  } catch {
    return { ok: false, error: { kind: 'schema', message: 'DonorDrive returned invalid JSON' } }
  }
}

/** Rate limits win (they need the longest wait), then a missing participant, then the rest */
const pickError = (errors: SnapshotError[]): SnapshotError => {
  const rateLimited = errors.filter((error) => error.kind === 'rate_limited')
  if (rateLimited.length > 0) {
    return rateLimited.reduce((a, b) => ((b.retryAfterSec ?? 0) > (a.retryAfterSec ?? 0) ? b : a))
  }
  return errors.find((error) => error.kind === 'not_found') ?? errors[0]
}

const loadSnapshot = async ({ host, pid }: FetchSnapshotInput): Promise<SnapshotResult> => {
  let urls: [string, string, string]
  try {
    urls = [
      buildParticipantUrl(host, pid),
      buildParticipantUrl(host, pid, 'donations', { limit: SNAPSHOT_DONATIONS_LIMIT }),
      buildParticipantUrl(host, pid, 'incentives'),
    ]
  } catch {
    return { ok: false, error: { kind: 'not_found', message: 'Invalid host or participant id' } }
  }

  const signal = AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS)
  const [participant, donations, rawIncentives] = await Promise.all(
    urls.map((url) => fetchJson(url, signal))
  )
  // Incentives "may not be available for all instances": a 404 there means none
  const incentives: FetchJsonResult =
    participant.ok && !rawIncentives.ok && rawIncentives.error.kind === 'not_found'
      ? { ok: true, data: [] }
      : rawIncentives

  if (!participant.ok || !donations.ok || !incentives.ok) {
    const errors = [participant, donations, incentives].flatMap((r) => (r.ok ? [] : [r.error]))
    return { ok: false, error: pickError(errors) }
  }

  const parsed = parseSnapshot(
    { participant: participant.data, donations: donations.data, incentives: incentives.data },
    new Date()
  )
  return parsed.ok
    ? { ok: true, snapshot: parsed.snapshot }
    : { ok: false, error: { kind: 'schema', message: parsed.message } }
}

const ttlFor = (result: SnapshotResult) =>
  !result.ok && result.error.kind === 'rate_limited'
    ? Math.max(SNAPSHOT_CACHE_TTL_MS, (result.error.retryAfterSec ?? 0) * 1000)
    : SNAPSHOT_CACHE_TTL_MS

const pruneCache = (now: number) => {
  if (cache.size < CACHE_PRUNE_SIZE) return
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key)
  }
}

/** A cached 429 reports the time left until it expires, not the original Retry-After */
const fromCache = (entry: CacheEntry, now: number): SnapshotResult => {
  const { result } = entry
  if (result.ok || result.error.kind !== 'rate_limited') return result
  return {
    ok: false,
    error: {
      ...result.error,
      retryAfterSec: Math.max(1, Math.ceil((entry.expiresAt - now) / 1000)),
    },
  }
}

/**
 * Fetches a participant snapshot from DonorDrive. Results (including errors) are cached per
 * host and pid for 15 s, a 429 for its Retry-After, and concurrent calls share one fetch.
 * Never throws.
 */
export const fetchSnapshot = async (input: FetchSnapshotInput): Promise<SnapshotResult> => {
  const key = `${input.host}:${input.pid}`
  const now = Date.now()

  const cached = cache.get(key)
  if (cached && cached.expiresAt > now) return fromCache(cached, now)

  const pending = inFlight.get(key)
  if (pending) return pending

  const request = loadSnapshot(input)
    .catch((): SnapshotResult => ({
      ok: false,
      error: { kind: 'upstream', message: 'Unexpected error while fetching DonorDrive' },
    }))
    .then((result) => {
      const doneAt = Date.now()
      pruneCache(doneAt)
      cache.set(key, { result, expiresAt: doneAt + ttlFor(result) })
      return result
    })
    .finally(() => inFlight.delete(key))

  inFlight.set(key, request)
  return request
}
