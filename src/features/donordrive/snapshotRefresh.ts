import {
  etagsDiffer,
  fetchDonorDrive,
  NESTED_MAX_AGE_MS,
  pickError,
  SNAPSHOT_DONATIONS_LIMIT,
  SNAPSHOT_FRESH_MS,
  SNAPSHOT_TIMEOUT_MS,
  type UpstreamDeps,
  type UpstreamResult,
} from './donorDriveFetch'
import { buildParticipantUrl } from './hosts'
import { parseSnapshot, type RawSnapshotParts } from './schemas'
import type { GetSnapshotInput } from './snapshotInput'
import type { SnapshotError, SnapshotResult } from './types'

export type SnapshotRawParts = RawSnapshotParts

/** Persisted per participant (JSON-safe). Timestamps are epoch milliseconds. */
export type SnapshotCacheState = {
  v: 1
  /** `${host}:${pid}` */
  key: string
  /** ETag of the participant response the raw parts were built from */
  etag?: string
  /** Last successfully validated raw responses */
  raw?: SnapshotRawParts
  /** When donations and incentives were last fetched */
  nestedFetchedAt?: number
  /** When DonorDrive was last contacted */
  checkedAt?: number
  /** No request is made to DonorDrive before this time */
  rateLimitedUntil?: number
  /** Result of the last refresh */
  result?: SnapshotResult
}

type RefreshOutcome = { result: SnapshotResult; state: SnapshotCacheState }

export const snapshotKey = (input: GetSnapshotInput): string => `${input.host}:${input.pid}`

export const emptySnapshotState = (key: string): SnapshotCacheState => ({ v: 1, key })

const failure = (error: SnapshotError): SnapshotResult => ({ ok: false, error })

const unexpectedError = (): SnapshotResult =>
  failure({ kind: 'upstream', message: 'Unexpected error while fetching DonorDrive' })

/**
 * Returns the stored result while it can be served without contacting DonorDrive:
 * a rate limit window still running, or a result checked less than 15 s ago.
 */
export const readFreshSnapshot = (
  state: SnapshotCacheState,
  now: number
): SnapshotResult | undefined => {
  if (state.rateLimitedUntil !== undefined && state.rateLimitedUntil > now) {
    return failure({
      kind: 'rate_limited',
      message: 'DonorDrive rate limit reached',
      retryAfterSec: Math.max(1, Math.ceil((state.rateLimitedUntil - now) / 1000)),
    })
  }
  const { result, checkedAt } = state
  if (!result || checkedAt === undefined || now - checkedAt >= SNAPSHOT_FRESH_MS) return undefined
  // A rate limit whose window has passed is retried right away
  if (!result.ok && result.error.kind === 'rate_limited') return undefined
  return result
}

const rateLimitedUntilFor = (error: SnapshotError, now: number) =>
  error.kind === 'rate_limited' && error.retryAfterSec !== undefined
    ? now + error.retryAfterSec * 1000
    : undefined

const readCount = (participant: unknown, field: 'sumDonations' | 'numDonations') => {
  if (typeof participant !== 'object' || participant === null) return undefined
  const value = (participant as Record<string, unknown>)[field]
  return typeof value === 'number' ? value : undefined
}

const countsDiffer = (a: unknown, b: unknown) =>
  readCount(a, 'sumDonations') !== readCount(b, 'sumDonations') ||
  readCount(a, 'numDonations') !== readCount(b, 'numDonations')

const fetchParticipant = async (
  url: string,
  deps: UpstreamDeps,
  etag: string | undefined,
  hasRaw: boolean
): Promise<UpstreamResult> => {
  const first = await fetchDonorDrive(url, deps, {
    etag,
    signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
  })
  if (first.status !== 'not_modified' || hasRaw) return first
  // A 304 with nothing stored to rebuild from (e.g. lost raw parts): retry once unconditionally
  // so this call can still return a snapshot instead of an error.
  const retry = await fetchDonorDrive(url, deps, {
    signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
  })
  return retry.status === 'not_modified'
    ? {
        status: 'error',
        error: { kind: 'upstream', message: 'DonorDrive returned 304 without a cached copy' },
      }
    : retry
}

type NestedResult =
  | { ok: true; donations: unknown; incentives: unknown }
  | { ok: false; error: SnapshotError }

const fetchNested = async (
  urls: { donations: string; incentives: string },
  deps: UpstreamDeps
): Promise<NestedResult> => {
  const signal = AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS)
  const [donations, rawIncentives] = await Promise.all([
    fetchDonorDrive(urls.donations, deps, { signal }),
    fetchDonorDrive(urls.incentives, deps, { signal }),
  ])
  // Incentives "may not be available for all instances": a 404 there means none
  const incentives: UpstreamResult =
    rawIncentives.status === 'error' && rawIncentives.error.kind === 'not_found'
      ? { status: 'ok', data: [] }
      : rawIncentives

  if (donations.status === 'ok' && incentives.status === 'ok') {
    return { ok: true, donations: donations.data, incentives: incentives.data }
  }
  // Nested requests never send If-None-Match, so a 304 there is unexpected
  const errors = [donations, incentives].flatMap((r): SnapshotError[] => {
    if (r.status === 'ok') return []
    if (r.status === 'error') return [r.error]
    return [{ kind: 'upstream', message: 'DonorDrive returned an unexpected 304' }]
  })
  return { ok: false, error: pickError(errors) }
}

const runRefresh = async (
  input: GetSnapshotInput,
  state: SnapshotCacheState,
  deps: UpstreamDeps,
  now: number
): Promise<RefreshOutcome> => {
  const done = (result: SnapshotResult, next: Partial<SnapshotCacheState> = {}): RefreshOutcome => {
    const nextState: SnapshotCacheState = { ...state, ...next, checkedAt: now, result }
    if (nextState.rateLimitedUntil !== undefined && nextState.rateLimitedUntil <= now) {
      delete nextState.rateLimitedUntil
    }
    return { result, state: nextState }
  }

  let urls: { participant: string; donations: string; incentives: string }
  try {
    urls = {
      participant: buildParticipantUrl(input.host, input.pid),
      donations: buildParticipantUrl(input.host, input.pid, 'donations', {
        limit: SNAPSHOT_DONATIONS_LIMIT,
      }),
      incentives: buildParticipantUrl(input.host, input.pid, 'incentives'),
    }
  } catch {
    return done(failure({ kind: 'not_found', message: 'Invalid host or participant id' }))
  }

  const fetchedAt = new Date(now)
  const participant = await fetchParticipant(urls.participant, deps, state.etag, !!state.raw)

  if (participant.status === 'not_modified') {
    // fetchParticipant only lets a 304 through when raw parts exist
    const raw = state.raw as SnapshotRawParts
    const parsed = parseSnapshot(raw, fetchedAt)
    return parsed.ok
      ? done({ ok: true, snapshot: parsed.snapshot })
      : done(failure({ kind: 'schema', message: parsed.message }), {
          etag: undefined,
          raw: undefined,
          nestedFetchedAt: undefined,
        })
  }

  if (participant.status === 'error') {
    const { error } = participant
    if (error.kind === 'not_found') {
      return done(failure(error), { etag: undefined, raw: undefined, nestedFetchedAt: undefined })
    }
    return done(failure(error), { rateLimitedUntil: rateLimitedUntilFor(error, now) })
  }

  const needNested =
    !state.raw ||
    etagsDiffer(state.etag, participant.etag) ||
    countsDiffer(state.raw.participant, participant.data) ||
    state.nestedFetchedAt === undefined ||
    now - state.nestedFetchedAt >= NESTED_MAX_AGE_MS

  let donations: unknown
  let incentives: unknown
  if (needNested) {
    const nested = await fetchNested(urls, deps)
    if (!nested.ok) {
      // Keep the previous etag and raw parts so the next call refetches the nested data
      return done(failure(nested.error), {
        rateLimitedUntil: rateLimitedUntilFor(nested.error, now),
      })
    }
    donations = nested.donations
    incentives = nested.incentives
  } else {
    // needNested is false only when raw exists
    const raw = state.raw as SnapshotRawParts
    donations = raw.donations
    incentives = raw.incentives
  }

  const raw: SnapshotRawParts = { participant: participant.data, donations, incentives }
  const parsed = parseSnapshot(raw, fetchedAt)
  if (!parsed.ok) return done(failure({ kind: 'schema', message: parsed.message }))

  return done(
    { ok: true, snapshot: parsed.snapshot },
    {
      etag: participant.etag ?? state.etag,
      raw,
      nestedFetchedAt: needNested ? now : state.nestedFetchedAt,
      rateLimitedUntil: undefined,
    }
  )
}

const stripUndefined = (state: SnapshotCacheState): SnapshotCacheState =>
  Object.fromEntries(
    Object.entries(state).filter(([, value]) => value !== undefined)
  ) as SnapshotCacheState

/**
 * Contacts DonorDrive (participant with If-None-Match, then donations and incentives only when
 * needed) and returns the result with the next state to save. Does not check freshness: callers
 * use `readFreshSnapshot` first. Never throws.
 */
export const refreshSnapshot = async (
  input: GetSnapshotInput,
  state: SnapshotCacheState,
  deps: UpstreamDeps
): Promise<RefreshOutcome> => {
  let now: number
  try {
    now = deps.now()
  } catch {
    now = Date.now()
  }
  try {
    const outcome = await runRefresh(input, state, deps, now)
    return { result: outcome.result, state: stripUndefined(outcome.state) }
  } catch {
    const result = unexpectedError()
    return { result, state: stripUndefined({ ...state, checkedAt: now, result }) }
  }
}
