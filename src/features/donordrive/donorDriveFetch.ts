import type { SnapshotError } from './types'

export const SNAPSHOT_TIMEOUT_MS = 8_000
// MVP-SHORTCUT(MVP-07): only the latest page of donations (limit 50); older donations are never paged
export const SNAPSHOT_DONATIONS_LIMIT = 50
/** Used when a 429 has no usable Retry-After */
export const DEFAULT_RETRY_AFTER_SEC = 60
/** Upper bound for any Retry-After we honour */
export const MAX_RETRY_AFTER_SEC = 3600
/** How long a snapshot is served without contacting DonorDrive */
export const SNAPSHOT_FRESH_MS = 15_000
/** Max age of the participant/incentives responses before they are revalidated */
export const NESTED_MAX_AGE_MS = 300_000

export const DONORDRIVE_USER_AGENT = 'donordrive-obs-dock/0.1'

export type UpstreamResult =
  | { status: 'ok'; data: unknown; etag?: string }
  | { status: 'not_modified' }
  | { status: 'error'; error: SnapshotError }

export type UpstreamDeps = {
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  now: () => number
}

/** Parses Retry-After (delta seconds or an HTTP date) into whole seconds */
export const parseRetryAfter = (value: string | null, now: number = Date.now()) => {
  if (!value) return undefined
  const trimmed = value.trim()
  const seconds = /^\d+$/.test(trimmed) ? Number(trimmed) : (Date.parse(trimmed) - now) / 1000
  if (!Number.isFinite(seconds)) return undefined
  return Math.min(MAX_RETRY_AFTER_SEC, Math.max(1, Math.ceil(seconds)))
}

/** Rate limits win (they need the longest wait), then a missing participant, then the rest */
export const pickError = (errors: SnapshotError[]): SnapshotError => {
  const rateLimited = errors.filter((error) => error.kind === 'rate_limited')
  if (rateLimited.length > 0) {
    return rateLimited.reduce((a, b) => ((b.retryAfterSec ?? 0) > (a.retryAfterSec ?? 0) ? b : a))
  }
  return errors.find((error) => error.kind === 'not_found') ?? errors[0]
}

const upstreamError = (error: SnapshotError): UpstreamResult => ({ status: 'error', error })

/**
 * Fetches one DonorDrive JSON endpoint, optionally revalidating with an ETag.
 * Maps every failure to a `SnapshotError`. Never throws.
 */
export const fetchDonorDrive = async (
  url: string,
  deps: UpstreamDeps,
  options?: { etag?: string; signal?: AbortSignal }
): Promise<UpstreamResult> => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': DONORDRIVE_USER_AGENT,
  }
  if (options?.etag) headers['If-None-Match'] = options.etag

  let response: Response
  try {
    response = await deps.fetch(url, { signal: options?.signal, headers })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return upstreamError({
      kind: 'upstream',
      message: timedOut ? 'DonorDrive did not respond in time' : 'Could not reach DonorDrive',
    })
  }

  if (response.status === 304) return { status: 'not_modified' }
  if (response.status === 404) {
    return upstreamError({ kind: 'not_found', message: 'Participant not found' })
  }
  if (response.status === 429) {
    return upstreamError({
      kind: 'rate_limited',
      message: 'DonorDrive rate limit reached',
      retryAfterSec:
        parseRetryAfter(response.headers.get('Retry-After'), deps.now()) ?? DEFAULT_RETRY_AFTER_SEC,
    })
  }
  if (!response.ok) {
    return upstreamError({
      kind: 'upstream',
      message: `DonorDrive responded with ${response.status}`,
    })
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    return upstreamError({ kind: 'schema', message: 'DonorDrive returned invalid JSON' })
  }
  const etag = response.headers.get('ETag')
  return etag ? { status: 'ok', data, etag } : { status: 'ok', data }
}

const normalizeEtag = (etag: string) =>
  etag
    .trim()
    .replace(/^W\//, '')
    .replace(/^"(.*)"$/, '$1')
    .trim()

/** True only when both ETags are present and name different representations (weak/strong ignored) */
export const etagsDiffer = (a?: string, b?: string): boolean => {
  if (!a || !b) return false
  return normalizeEtag(a) !== normalizeEtag(b)
}
