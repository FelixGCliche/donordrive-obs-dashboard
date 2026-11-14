import {
  fetchDonorDrive,
  pickError,
  SNAPSHOT_FRESH_MS,
  SNAPSHOT_TIMEOUT_MS,
  type UpstreamDeps,
  type UpstreamResult,
} from './donorDriveFetch'
import { buildParticipantUrl } from './hosts'
import {
  normalizeDonations,
  normalizeIncentives,
  rawDonationsSchema,
  rawIncentivesSchema,
  rawParticipantSchema,
  type RawDonation,
} from './schemas'
import type { GetSnapshotInput } from './snapshotInput'
import type { Donation, Incentive, SnapshotError } from './types'

/** Donations requested per page (the DonorDrive maximum) */
export const ALL_DONATIONS_PAGE_SIZE = 100
// MVP-SHORTCUT(MVP-15): full donation history is capped at 20 pages (2000 donations); older ones are ignored
export const ALL_DONATIONS_MAX_PAGES = 20

export type AllDonationsResult =
  | {
      ok: true
      /** Participant id as DonorDrive reports it (the input pid may be an alias) */
      participantId: string
      /** Newest first, deduped by id */
      donations: Donation[]
      incentives: Incentive[]
    }
  | { ok: false; error: SnapshotError }

export type AllDonationsFetcher = (input: GetSnapshotInput) => Promise<AllDonationsResult>

type CacheEntry = { result: AllDonationsResult; expiresAt: number }

const failure = (error: SnapshotError): AllDonationsResult => ({ ok: false, error })

const schemaError = (name: string): AllDonationsResult =>
  failure({ kind: 'schema', message: `Unexpected DonorDrive ${name} response` })

const unexpected304: SnapshotError = {
  kind: 'upstream',
  message: 'DonorDrive returned an unexpected 304',
}

const errorOf = (result: UpstreamResult): SnapshotError | undefined => {
  if (result.status === 'ok') return undefined
  return result.status === 'error' ? result.error : unexpected304
}

const get = (url: string, deps: UpstreamDeps) =>
  fetchDonorDrive(url, deps, { signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS) })

type PagesResult =
  | { ok: true; donations: RawDonation[] }
  | { ok: false; result: AllDonationsResult }

/** Pages `/donations` until a short page or the page cap; later pages may repeat shifted donations. */
const fetchDonationPages = async (
  input: GetSnapshotInput,
  deps: UpstreamDeps
): Promise<PagesResult> => {
  const byId = new Map<string, RawDonation>()
  for (let page = 0; page < ALL_DONATIONS_MAX_PAGES; page++) {
    // The default API version (1.0) has a 1-based offset and rejects `offset=0` with a 400; 1.1+
    // is 0-based. Omitting it on the first page and using multiples of the page size after works
    // for both: a 1-based page repeats the previous page's last donation, which the dedupe drops.
    const url = buildParticipantUrl(input.host, input.pid, 'donations', {
      limit: ALL_DONATIONS_PAGE_SIZE,
      ...(page === 0 ? {} : { offset: page * ALL_DONATIONS_PAGE_SIZE }),
    })
    const response = await get(url, deps)
    const error = errorOf(response)
    if (error || response.status !== 'ok') {
      return { ok: false, result: failure(error ?? unexpected304) }
    }
    const parsed = rawDonationsSchema.safeParse(response.data)
    if (!parsed.success) return { ok: false, result: schemaError('donations') }
    for (const donation of parsed.data) {
      if (!byId.has(donation.donationID)) byId.set(donation.donationID, donation)
    }
    if (parsed.data.length < ALL_DONATIONS_PAGE_SIZE) break
  }
  return { ok: true, donations: [...byId.values()] }
}

const runFetch = async (input: GetSnapshotInput, deps: UpstreamDeps, now: number) => {
  let urls: { participant: string; incentives: string }
  try {
    urls = {
      participant: buildParticipantUrl(input.host, input.pid),
      incentives: buildParticipantUrl(input.host, input.pid, 'incentives'),
    }
  } catch {
    return failure({ kind: 'not_found', message: 'Invalid host or participant id' })
  }

  const [participant, rawIncentives, pages] = await Promise.all([
    get(urls.participant, deps),
    get(urls.incentives, deps),
    fetchDonationPages(input, deps),
  ])
  // Incentives "may not be available for all instances": a 404 there means none
  const incentives: UpstreamResult =
    rawIncentives.status === 'error' && rawIncentives.error.kind === 'not_found'
      ? { status: 'ok', data: [] }
      : rawIncentives

  const errors = [errorOf(participant), errorOf(incentives)].filter(
    (error): error is SnapshotError => error !== undefined
  )
  if (!pages.ok && !pages.result.ok) errors.push(pages.result.error)
  if (errors.length > 0) return failure(pickError(errors))
  if (participant.status !== 'ok' || incentives.status !== 'ok' || !pages.ok) {
    return failure(unexpected304)
  }

  const parsedParticipant = rawParticipantSchema.safeParse(participant.data)
  if (!parsedParticipant.success) return schemaError('participant')
  const parsedIncentives = rawIncentivesSchema.safeParse(incentives.data)
  if (!parsedIncentives.success) return schemaError('incentives')

  return {
    ok: true,
    participantId: parsedParticipant.data.participantID,
    donations: normalizeDonations(pages.donations),
    incentives: normalizeIncentives(parsedIncentives.data, new Date(now)),
  } satisfies AllDonationsResult
}

/** How long a result is served from the cache; a rate limit is held until its window ends. */
const expiryOf = (result: AllDonationsResult, now: number) => {
  const fresh = now + SNAPSHOT_FRESH_MS
  if (result.ok || result.error.kind !== 'rate_limited') return fresh
  return Math.max(fresh, now + (result.error.retryAfterSec ?? 0) * 1000)
}

/** A cached rate limit reports the time left in its window, not the original Retry-After. */
const fromCache = (entry: CacheEntry, now: number): AllDonationsResult => {
  const { result } = entry
  if (result.ok || result.error.kind !== 'rate_limited') return result
  return failure({
    ...result.error,
    retryAfterSec: Math.max(1, Math.ceil((entry.expiresAt - now) / 1000)),
  })
}

/**
 * Fetches a participant's full donation history (paged), incentives and participant id.
 * Results are cached for 15 s per host and pid, and concurrent calls share one fetch.
 * The returned function never rejects.
 */
export const createAllDonationsFetcher = (deps: UpstreamDeps): AllDonationsFetcher => {
  const cache = new Map<string, CacheEntry>()
  const inFlight = new Map<string, Promise<AllDonationsResult>>()

  const prune = (now: number) => {
    for (const [key, entry] of cache) if (entry.expiresAt <= now) cache.delete(key)
  }

  return (input) => {
    const key = `${input.host}:${input.pid}`
    const now = deps.now()
    const cached = cache.get(key)
    if (cached && cached.expiresAt > now) return Promise.resolve(fromCache(cached, now))

    const pending = inFlight.get(key)
    if (pending) return pending

    const request = (async (): Promise<AllDonationsResult> => {
      let result: AllDonationsResult
      try {
        result = await runFetch(input, deps, now)
      } catch {
        result = failure({
          kind: 'upstream',
          message: 'Unexpected error while fetching DonorDrive',
        })
      }
      const doneAt = deps.now()
      prune(doneAt)
      cache.set(key, { result, expiresAt: expiryOf(result, doneAt) })
      return result
    })().finally(() => inFlight.delete(key))

    inFlight.set(key, request)
    return request
  }
}

let defaultFetcher: AllDonationsFetcher | undefined

/** Shared per-isolate fetcher using the global `fetch`. Never rejects. */
export const fetchAllDonations: AllDonationsFetcher = (input) => {
  defaultFetcher ??= createAllDonationsFetcher({
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
  })
  return defaultFetcher(input)
}
