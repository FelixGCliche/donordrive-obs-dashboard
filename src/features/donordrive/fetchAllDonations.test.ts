import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'

import type { UpstreamDeps } from './donorDriveFetch'
import {
  ALL_DONATIONS_MAX_PAGES,
  ALL_DONATIONS_PAGE_SIZE,
  createAllDonationsFetcher,
  fetchAllDonations,
} from './fetchAllDonations'

const NOW = Date.parse('2026-11-11T12:00:00.000Z')
const INPUT = { host: 'extralife', pid: '500001' } as const

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })

const rawDonation = (n: number) => ({
  donationID: `D${n}`,
  displayName: `Donor ${n}`,
  amount: 10,
  createdDateUTC: new Date(NOW - n * 60_000).toISOString(),
  ...(n % 2 === 0 ? { incentiveID: 'I1' } : {}),
})

const page = (offset: number, size: number) =>
  Array.from({ length: size }, (_, index) => rawDonation(offset + index))

type Routes = {
  participant?: () => Response
  incentives?: () => Response
  /** Called with the requested offset */
  donations?: (offset: number) => Response
}

const makeFetcher = (routes: Routes, clock = { now: NOW }) => {
  const fetch = mock(async (input: string, _init?: RequestInit) => {
    const url = new URL(input)
    if (url.pathname.endsWith('/donations')) {
      return (routes.donations ?? (() => json([])))(Number(url.searchParams.get('offset')))
    }
    if (url.pathname.endsWith('/incentives')) {
      return (routes.incentives ?? (() => json([])))()
    }
    return (
      routes.participant ?? (() => json({ participantID: 500001, displayName: 'Streamer' }))
    )()
  })
  const deps: UpstreamDeps = { fetch, now: () => clock.now }
  return { fetchAll: createAllDonationsFetcher(deps), fetch, clock }
}

const donationCalls = (fetch: ReturnType<typeof makeFetcher>['fetch']) =>
  fetch.mock.calls
    .map(([input]) => new URL(input))
    .filter((url) => url.pathname.endsWith('/donations'))

describe('createAllDonationsFetcher', () => {
  test('pages donations until a short page', async () => {
    const { fetchAll, fetch } = makeFetcher({
      donations: (offset) => json(offset < 200 ? page(offset, 100) : page(offset, 30)),
      incentives: () => json([{ incentiveID: 'I1', description: 'Pick a hero', amount: 5 }]),
    })
    const result = await fetchAll(INPUT)
    if (!result.ok) throw new Error('expected ok')
    expect(result.participantId).toBe('500001')
    expect(result.donations).toHaveLength(230)
    // Newest first
    expect(result.donations[0]?.id).toBe('D0')
    expect(result.incentives.map((incentive) => incentive.id)).toEqual(['I1'])
    const calls = donationCalls(fetch)
    expect(calls.map((url) => url.searchParams.get('offset'))).toEqual(['0', '100', '200'])
    expect(calls.every((url) => url.searchParams.get('limit') === '100')).toBe(true)
  })

  test('stops at the page cap', async () => {
    const { fetchAll, fetch } = makeFetcher({ donations: (offset) => json(page(offset, 100)) })
    const result = await fetchAll(INPUT)
    if (!result.ok) throw new Error('expected ok')
    expect(donationCalls(fetch)).toHaveLength(ALL_DONATIONS_MAX_PAGES)
    expect(result.donations).toHaveLength(ALL_DONATIONS_MAX_PAGES * ALL_DONATIONS_PAGE_SIZE)
  })

  test('dedupes donations repeated across pages', async () => {
    const { fetchAll } = makeFetcher({
      // A new donation shifted the second page by one
      donations: (offset) => json(offset === 0 ? page(0, 100) : page(99, 2)),
    })
    const result = await fetchAll(INPUT)
    if (!result.ok) throw new Error('expected ok')
    expect(result.donations).toHaveLength(101)
  })

  test('treats a missing incentives endpoint as no incentives', async () => {
    const { fetchAll } = makeFetcher({ incentives: () => new Response(null, { status: 404 }) })
    const result = await fetchAll(INPUT)
    expect(result).toEqual({ ok: true, participantId: '500001', donations: [], incentives: [] })
  })

  test('maps a missing participant to not_found', async () => {
    const { fetchAll } = makeFetcher({ participant: () => new Response(null, { status: 404 }) })
    const result = await fetchAll(INPUT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('not_found')
  })

  test('maps a 429 to rate_limited and holds it for the Retry-After window', async () => {
    const { fetchAll, fetch, clock } = makeFetcher({
      donations: () => new Response(null, { status: 429, headers: { 'Retry-After': '120' } }),
    })
    const result = await fetchAll(INPUT)
    expect(result).toEqual({
      ok: false,
      error: { kind: 'rate_limited', message: 'DonorDrive rate limit reached', retryAfterSec: 120 },
    })

    const calls = fetch.mock.calls.length
    clock.now += 60_000
    const later = await fetchAll(INPUT)
    expect(fetch.mock.calls.length).toBe(calls)
    if (!later.ok) expect(later.error.retryAfterSec).toBe(60)
  })

  test('reports a schema error for an unexpected donations response', async () => {
    const { fetchAll } = makeFetcher({ donations: () => json({ nope: true }) })
    const result = await fetchAll(INPUT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('schema')
  })

  test('caches results for 15 s and shares concurrent calls', async () => {
    const { fetchAll, fetch, clock } = makeFetcher({})
    const [a, b] = await Promise.all([fetchAll(INPUT), fetchAll(INPUT)])
    expect(a).toBe(b)
    expect(fetch).toHaveBeenCalledTimes(3)

    clock.now += 10_000
    await fetchAll(INPUT)
    expect(fetch).toHaveBeenCalledTimes(3)

    clock.now += 10_000
    await fetchAll(INPUT)
    expect(fetch).toHaveBeenCalledTimes(6)
  })

  test('never rejects when fetch throws', async () => {
    const { fetchAll } = makeFetcher({
      participant: () => {
        throw new Error('boom')
      },
    })
    const result = await fetchAll(INPUT)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('upstream')
  })
})

describe('fetchAllDonations', () => {
  afterEach(() => mock.restore())

  test('uses the global fetch', async () => {
    const spy = spyOn(globalThis, 'fetch').mockImplementation((async (input: string | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/donations')) return json([rawDonation(2)])
      if (url.pathname.endsWith('/incentives')) return json([])
      return json({ participantID: 42, displayName: 'Streamer' })
    }) as unknown as typeof fetch)
    const result = await fetchAllDonations({ host: 'try', pid: 'alias-1' })
    expect(spy).toHaveBeenCalled()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.participantId).toBe('42')
      expect(result.donations.map((donation) => donation.id)).toEqual(['D2'])
    }
  })
})
