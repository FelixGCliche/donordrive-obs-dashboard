import { describe, expect, mock, test } from 'bun:test'

import {
  DEFAULT_RETRY_AFTER_SEC,
  NESTED_MAX_AGE_MS,
  SNAPSHOT_FRESH_MS,
  type UpstreamDeps,
} from './donorDriveFetch'
import {
  rawDonationsFixture,
  rawIncentivesFixture,
  rawParticipantFixture,
} from './snapshotFixtures'
import type { GetSnapshotInput } from './snapshotInput'
import {
  emptySnapshotState,
  readFreshSnapshot,
  refreshSnapshot,
  snapshotKey,
  type SnapshotCacheState,
} from './snapshotRefresh'
import type { SnapshotResult } from './types'

type Call = { url: URL; headers: Headers }
type Route = (url: URL, headers: Headers) => Response | Promise<Response>

const START = Date.parse('2026-11-11T12:00:00.000Z')
const INPUT: GetSnapshotInput = { host: 'extralife', pid: '500001' }
const ETAG = 'W/"v1"'

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })

const notFound = () => new Response('Not Found', { status: 404 })
const tooMany = (retryAfter?: string) =>
  new Response('', { status: 429, headers: retryAfter ? { 'Retry-After': retryAfter } : {} })

const isParticipant = (url: URL) => url.pathname === '/api/participants/500001'
const isDonations = (url: URL) => url.pathname.endsWith('/donations')
const isIncentives = (url: URL) => url.pathname.endsWith('/incentives')

/** Answers like DonorDrive: 304 when If-None-Match matches the participant's current ETag */
const okRoute =
  (options: { participant?: unknown; etag?: string; incentives?: unknown } = {}): Route =>
  (url, headers) => {
    if (isDonations(url)) return json(rawDonationsFixture)
    if (isIncentives(url)) return json(options.incentives ?? rawIncentivesFixture)
    const etag = options.etag ?? ETAG
    if (headers.get('If-None-Match') === etag) return new Response(null, { status: 304 })
    return json(options.participant ?? rawParticipantFixture, { headers: { ETag: etag } })
  }

/** Drives `readFreshSnapshot` + `refreshSnapshot` like the coordinator does */
const setup = (initialRoute: Route) => {
  let route = initialRoute
  let clock = START
  let state: SnapshotCacheState = emptySnapshotState(snapshotKey(INPUT))
  const calls: Call[] = []

  const fetch = mock(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    const headers = new Headers(init?.headers)
    calls.push({ url, headers })
    return route(url, headers)
  })
  const deps: UpstreamDeps = { fetch, now: () => clock }

  const get = async (): Promise<SnapshotResult> => {
    const fresh = readFreshSnapshot(state, clock)
    if (fresh) return fresh
    const outcome = await refreshSnapshot(INPUT, state, deps)
    state = outcome.state
    return outcome.result
  }

  return {
    get,
    calls,
    deps,
    advance: (ms: number) => {
      clock += ms
    },
    setRoute: (next: Route) => {
      route = next
    },
    getState: () => state,
    setState: (next: SnapshotCacheState) => {
      state = next
    },
  }
}

const AFTER_FRESH = SNAPSHOT_FRESH_MS + 1

describe('snapshotKey / emptySnapshotState', () => {
  test('keys by host and pid', () => {
    expect(snapshotKey(INPUT)).toBe('extralife:500001')
    expect(emptySnapshotState('k')).toEqual({ v: 1, key: 'k' })
  })
})

describe('refreshSnapshot', () => {
  test('first call makes 3 requests and returns a normalized snapshot', async () => {
    const t = setup(okRoute())
    const result = await t.get()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.participant.id).toBe('500001')
    expect(result.snapshot.donations).toHaveLength(4)
    expect(result.snapshot.incentives).toHaveLength(2)
    expect(result.snapshot.fetchedAt).toBe(new Date(START).toISOString())

    expect(t.calls.map(({ url }) => url.toString()).sort()).toEqual([
      'https://www.extra-life.org/api/participants/500001',
      'https://www.extra-life.org/api/participants/500001/donations?limit=50',
      'https://www.extra-life.org/api/participants/500001/incentives',
    ])
    expect(t.calls[0].headers.get('If-None-Match')).toBeNull()

    const state = t.getState()
    expect(state.etag).toBe(ETAG)
    expect(state.checkedAt).toBe(START)
    expect(state.nestedFetchedAt).toBe(START)
    expect(state.raw?.participant).toEqual(rawParticipantFixture)
    expect(state.result).toBe(result)
    // JSON-safe: no undefined-valued keys
    expect(Object.values(state).some((value) => value === undefined)).toBe(false)
  })

  test('a call within 15 s makes no requests', async () => {
    const t = setup(okRoute())
    const first = await t.get()
    t.advance(SNAPSHOT_FRESH_MS - 1)
    const second = await t.get()
    expect(t.calls).toHaveLength(3)
    expect(second).toBe(first)
  })

  test('a 304 makes 1 request and moves fetchedAt forward', async () => {
    const t = setup(okRoute())
    await t.get()
    t.advance(AFTER_FRESH)
    const result = await t.get()

    expect(t.calls).toHaveLength(4)
    expect(t.calls[3].headers.get('If-None-Match')).toBe(ETAG)
    expect(result.ok && result.snapshot.fetchedAt).toBe(new Date(START + AFTER_FRESH).toISOString())
    expect(t.getState().checkedAt).toBe(START + AFTER_FRESH)
  })

  test('same ETag and counts on a 200 makes 1 request and reuses nested data', async () => {
    const t = setup(okRoute())
    await t.get()
    // Server ignores If-None-Match but sends the same (strong form of the) ETag
    t.setRoute((url) => okRoute({ etag: '"v1"' })(url, new Headers()))
    t.advance(AFTER_FRESH)
    const result = await t.get()

    expect(t.calls).toHaveLength(4)
    expect(result.ok && result.snapshot.donations).toHaveLength(4)
    expect(t.getState().nestedFetchedAt).toBe(START)
    expect(t.getState().etag).toBe('"v1"')
  })

  test('a new ETag refetches donations and incentives', async () => {
    const t = setup(okRoute())
    await t.get()
    t.setRoute(okRoute({ etag: 'W/"v2"' }))
    t.advance(AFTER_FRESH)
    await t.get()

    expect(t.calls).toHaveLength(6)
    expect(t.getState().etag).toBe('W/"v2"')
    expect(t.getState().nestedFetchedAt).toBe(START + AFTER_FRESH)
  })

  test('a changed numDonations refetches nested data even with the same ETag', async () => {
    const t = setup(okRoute())
    await t.get()
    t.setRoute((url) =>
      okRoute({ participant: { ...rawParticipantFixture, numDonations: 5 } })(url, new Headers())
    )
    t.advance(AFTER_FRESH)
    const result = await t.get()

    expect(t.calls).toHaveLength(6)
    expect(result.ok && result.snapshot.participant.numDonations).toBe(5)
  })

  test('nested data 5 min old is refetched', async () => {
    const t = setup(okRoute())
    await t.get()
    t.setRoute((url) => okRoute()(url, new Headers()))
    t.advance(NESTED_MAX_AGE_MS)
    await t.get()

    expect(t.calls).toHaveLength(6)
    expect(t.getState().nestedFetchedAt).toBe(START + NESTED_MAX_AGE_MS)
  })

  test('a 429 blocks requests for the window, counts down, then resumes', async () => {
    const t = setup(() => tooMany('90'))
    const first = await t.get()
    expect(first).toEqual({
      ok: false,
      error: { kind: 'rate_limited', message: 'DonorDrive rate limit reached', retryAfterSec: 90 },
    })
    expect(t.calls).toHaveLength(1)
    expect(t.getState().rateLimitedUntil).toBe(START + 90_000)

    t.advance(60_000)
    const waiting = await t.get()
    expect(t.calls).toHaveLength(1)
    expect(!waiting.ok && waiting.error.retryAfterSec).toBe(30)

    t.advance(29_500)
    const almost = await t.get()
    expect(!almost.ok && almost.error.retryAfterSec).toBe(1)
    expect(t.calls).toHaveLength(1)

    t.setRoute(okRoute())
    t.advance(501)
    const resumed = await t.get()
    expect(resumed.ok).toBe(true)
    expect(t.calls).toHaveLength(4)
    expect(t.getState().rateLimitedUntil).toBeUndefined()
  })

  test('a 429 without Retry-After waits 60 s', async () => {
    const t = setup(() => tooMany())
    const result = await t.get()
    expect(!result.ok && result.error.retryAfterSec).toBe(DEFAULT_RETRY_AFTER_SEC)
    expect(t.getState().rateLimitedUntil).toBe(START + DEFAULT_RETRY_AFTER_SEC * 1000)
  })

  test('a nested-only 429 keeps the old ETag and raw parts', async () => {
    const t = setup(okRoute())
    const first = await t.get()
    const before = t.getState()

    t.setRoute((url, headers) =>
      isDonations(url) ? tooMany('30') : okRoute({ etag: 'W/"v2"' })(url, headers)
    )
    t.advance(AFTER_FRESH)
    const result = await t.get()

    expect(!result.ok && result.error).toEqual({
      kind: 'rate_limited',
      message: 'DonorDrive rate limit reached',
      retryAfterSec: 30,
    })
    const state = t.getState()
    expect(state.etag).toBe(ETAG)
    expect(state.raw).toBe(before.raw)
    expect(state.nestedFetchedAt).toBe(START)
    expect(state.rateLimitedUntil).toBe(START + AFTER_FRESH + 30_000)
    expect(first.ok).toBe(true)
  })

  test('nested errors prefer the longest rate limit, then not_found', async () => {
    const t = setup((url, headers) => {
      if (isDonations(url)) return tooMany('10')
      if (isIncentives(url)) return tooMany('40')
      return okRoute()(url, headers)
    })
    const result = await t.get()
    expect(!result.ok && result.error.retryAfterSec).toBe(40)

    const t2 = setup((url, headers) => {
      if (isDonations(url)) return notFound()
      if (isIncentives(url)) return new Response('', { status: 503 })
      return okRoute()(url, headers)
    })
    const result2 = await t2.get()
    expect(!result2.ok && result2.error.kind).toBe('not_found')
  })

  test('a 404 clears the state', async () => {
    const t = setup(okRoute())
    await t.get()
    t.setRoute(notFound)
    t.advance(AFTER_FRESH)
    const result = await t.get()

    expect(result).toEqual({
      ok: false,
      error: { kind: 'not_found', message: 'Participant not found' },
    })
    const state = t.getState()
    expect(state.etag).toBeUndefined()
    expect(state.raw).toBeUndefined()
    expect(state.nestedFetchedAt).toBeUndefined()
    expect(state.checkedAt).toBe(START + AFTER_FRESH)
  })

  test('an incentives 404 gives no incentives', async () => {
    const t = setup((url, headers) => (isIncentives(url) ? notFound() : okRoute()(url, headers)))
    const result = await t.get()
    expect(result.ok && result.snapshot.incentives).toEqual([])
  })

  test('after an upstream error, a later 304 rebuilds the snapshot', async () => {
    const t = setup(okRoute())
    await t.get()
    t.setRoute(() => new Response('', { status: 503 }))
    t.advance(AFTER_FRESH)
    const failed = await t.get()
    expect(failed).toEqual({
      ok: false,
      error: { kind: 'upstream', message: 'DonorDrive responded with 503' },
    })
    expect(t.getState().etag).toBe(ETAG)
    expect(t.getState().raw).toBeDefined()

    t.setRoute(okRoute())
    t.advance(AFTER_FRESH)
    const result = await t.get()
    expect(result.ok).toBe(true)
    expect(t.calls).toHaveLength(5)
    expect(t.calls[4].headers.get('If-None-Match')).toBe(ETAG)
  })

  test('a schema error is returned and the raw parts are not saved', async () => {
    const t = setup((url, headers) =>
      isParticipant(url)
        ? json({ participantID: 1 }, { headers: { ETag: ETAG } })
        : okRoute()(url, headers)
    )
    const result = await t.get()
    expect(!result.ok && result.error.kind).toBe('schema')
    expect(!result.ok && result.error.message).toContain('participant')
    expect(t.getState().raw).toBeUndefined()
    expect(t.getState().etag).toBeUndefined()
  })

  test('an invalid pid makes no request', async () => {
    const t = setup(okRoute())
    const { result } = await refreshSnapshot(
      { host: 'extralife', pid: '../admin' },
      emptySnapshotState('extralife:../admin'),
      t.deps
    )
    expect(result).toEqual({
      ok: false,
      error: { kind: 'not_found', message: 'Invalid host or participant id' },
    })
    expect(t.calls).toHaveLength(0)
  })

  test('a 304 with no raw parts retries without If-None-Match and recovers', async () => {
    const t = setup(okRoute())
    t.setState({ v: 1, key: snapshotKey(INPUT), etag: ETAG })
    const result = await t.get()

    expect(result.ok).toBe(true)
    expect(t.calls).toHaveLength(4)
    expect(t.calls[0].headers.get('If-None-Match')).toBe(ETAG)
    expect(t.calls[1].headers.get('If-None-Match')).toBeNull()
    expect(t.getState().raw).toBeDefined()
  })

  test('incentive isActive flips on a 304 once its end date passes', async () => {
    const { isActive: _ignored, ...timed } = rawIncentivesFixture[1]
    const incentives = [{ ...timed, endDateUTC: '2026-11-11T12:00:20.0+0000' }]
    const t = setup(okRoute({ incentives }))

    const first = await t.get()
    expect(first.ok && first.snapshot.incentives[0].isActive).toBe(true)

    t.advance(20_000)
    const second = await t.get()
    expect(t.calls).toHaveLength(4)
    expect(second.ok && second.snapshot.incentives[0].isActive).toBe(false)
  })

  test('never throws: an unexpected error becomes an upstream error', async () => {
    const t = setup(okRoute())
    const deps: UpstreamDeps = {
      now: t.deps.now,
      // fetchDonorDrive catches fetch rejections, but not a broken Response
      fetch: async () =>
        ({
          get status(): number {
            throw new Error('boom')
          },
        }) as unknown as Response,
    }
    const state: SnapshotCacheState = { v: 1, key: snapshotKey(INPUT), etag: ETAG }
    const outcome = await refreshSnapshot(INPUT, state, deps)
    expect(outcome.result).toEqual({
      ok: false,
      error: { kind: 'upstream', message: 'Unexpected error while fetching DonorDrive' },
    })
    expect(outcome.state.checkedAt).toBe(START)
    expect(outcome.state.etag).toBe(ETAG)
  })
})

describe('readFreshSnapshot', () => {
  test('ignores a stored rate limit whose window has passed', () => {
    const result: SnapshotResult = {
      ok: false,
      error: { kind: 'rate_limited', message: 'DonorDrive rate limit reached', retryAfterSec: 5 },
    }
    const state: SnapshotCacheState = {
      v: 1,
      key: 'k',
      checkedAt: START,
      rateLimitedUntil: START + 5_000,
      result,
    }
    expect(readFreshSnapshot(state, START + 1_000)).toBeDefined()
    expect(readFreshSnapshot(state, START + 6_000)).toBeUndefined()
  })
})
