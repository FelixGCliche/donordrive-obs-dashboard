import { afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from 'bun:test'

import {
  clearSnapshotCache,
  DEFAULT_RETRY_AFTER_SEC,
  DONORDRIVE_USER_AGENT,
  fetchSnapshot,
  parseRetryAfter,
} from './fetchSnapshot'
import {
  rawDonationsFixture,
  rawIncentivesFixture,
  rawParticipantFixture,
} from './snapshotFixtures'

type Route = (url: URL) => Response | Promise<Response>

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })

const okRoute: Route = (url) => {
  if (url.pathname.endsWith('/donations')) return json(rawDonationsFixture)
  if (url.pathname.endsWith('/incentives')) return json(rawIncentivesFixture)
  return json(rawParticipantFixture)
}

const originalFetch = globalThis.fetch
let calls: { url: URL; init?: RequestInit }[] = []

const mockFetch = (route: Route) => {
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input)
    calls.push({ url, init })
    return route(url)
  }) as unknown as typeof fetch
}

const start = new Date('2026-11-11T12:00:00.000Z')

beforeEach(() => {
  calls = []
  clearSnapshotCache()
  setSystemTime(start)
})

afterEach(() => {
  globalThis.fetch = originalFetch
  setSystemTime()
})

describe('fetchSnapshot', () => {
  test('fetches the three endpoints and normalizes them', async () => {
    mockFetch(okRoute)
    const result = await fetchSnapshot({ host: 'extralife', pid: '500001' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.participant.id).toBe('500001')
    expect(result.snapshot.donations).toHaveLength(4)
    expect(result.snapshot.incentives).toHaveLength(2)
    expect(result.snapshot.fetchedAt).toBe(start.toISOString())

    expect(calls.map(({ url }) => url.toString()).sort()).toEqual([
      'https://www.extra-life.org/api/participants/500001',
      'https://www.extra-life.org/api/participants/500001/donations?limit=50',
      'https://www.extra-life.org/api/participants/500001/incentives',
    ])
    const headers = new Headers(calls[0].init?.headers)
    expect(headers.get('User-Agent')).toBe(DONORDRIVE_USER_AGENT)
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal)
  })

  test('caches results for 15 s per host and pid', async () => {
    mockFetch(okRoute)
    await fetchSnapshot({ host: 'extralife', pid: '500001' })
    await fetchSnapshot({ host: 'extralife', pid: '500001' })
    expect(calls).toHaveLength(3)

    await fetchSnapshot({ host: 'try', pid: '500001' })
    expect(calls).toHaveLength(6)

    setSystemTime(new Date(start.getTime() + 15_001))
    await fetchSnapshot({ host: 'extralife', pid: '500001' })
    expect(calls).toHaveLength(9)
  })

  test('merges concurrent requests for the same key', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mockFetch(async (url) => {
      await gate
      return okRoute(url)
    })

    const pending = Array.from({ length: 5 }, () =>
      fetchSnapshot({ host: 'extralife', pid: '500001' })
    )
    release()
    const results = await Promise.all(pending)

    expect(calls).toHaveLength(3)
    expect(results.every((r) => r === results[0])).toBe(true)
  })

  test('maps 404 to not_found', async () => {
    mockFetch(() => new Response('Not Found', { status: 404 }))
    const result = await fetchSnapshot({ host: 'extralife', pid: '1' })
    expect(result).toEqual({
      ok: false,
      error: { kind: 'not_found', message: 'Participant not found' },
    })
  })

  test('treats a missing incentives endpoint as no incentives', async () => {
    mockFetch((url) =>
      url.pathname.endsWith('/incentives')
        ? new Response('Not Found', { status: 404 })
        : okRoute(url)
    )
    const result = await fetchSnapshot({ host: 'extralife', pid: '500001' })
    expect(result.ok && result.snapshot.incentives).toEqual([])
  })

  test('maps 429 to rate_limited and caches it for Retry-After', async () => {
    mockFetch((url) =>
      url.pathname.endsWith('/donations')
        ? new Response('', { status: 429, headers: { 'Retry-After': '90' } })
        : okRoute(url)
    )
    const first = await fetchSnapshot({ host: 'extralife', pid: '500001' })
    expect(first).toEqual({
      ok: false,
      error: { kind: 'rate_limited', message: 'DonorDrive rate limit reached', retryAfterSec: 90 },
    })

    setSystemTime(new Date(start.getTime() + 60_000))
    const cached = await fetchSnapshot({ host: 'extralife', pid: '500001' })
    expect(calls).toHaveLength(3)
    expect(!cached.ok && cached.error.retryAfterSec).toBe(30)

    setSystemTime(new Date(start.getTime() + 90_001))
    mockFetch(okRoute)
    expect((await fetchSnapshot({ host: 'extralife', pid: '500001' })).ok).toBe(true)
  })

  test('uses a default wait when a 429 has no Retry-After', async () => {
    mockFetch(() => new Response('', { status: 429 }))
    const result = await fetchSnapshot({ host: 'extralife', pid: '500001' })
    expect(!result.ok && result.error.retryAfterSec).toBe(DEFAULT_RETRY_AFTER_SEC)
  })

  test('maps other statuses and network failures to upstream', async () => {
    mockFetch(() => new Response('', { status: 503 }))
    const status = await fetchSnapshot({ host: 'extralife', pid: '1' })
    expect(!status.ok && status.error).toEqual({
      kind: 'upstream',
      message: 'DonorDrive responded with 503',
    })

    mockFetch(() => {
      throw new TypeError('network down')
    })
    const network = await fetchSnapshot({ host: 'extralife', pid: '2' })
    expect(!network.ok && network.error.kind).toBe('upstream')

    mockFetch(() => {
      throw new DOMException('timed out', 'TimeoutError')
    })
    const timeout = await fetchSnapshot({ host: 'extralife', pid: '3' })
    expect(!timeout.ok && timeout.error.message).toBe('DonorDrive did not respond in time')
  })

  test('maps invalid payloads to schema', async () => {
    mockFetch((url) =>
      url.pathname.endsWith('/donations') ? json({ not: 'an array' }) : okRoute(url)
    )
    const shape = await fetchSnapshot({ host: 'extralife', pid: '1' })
    expect(!shape.ok && shape.error.kind).toBe('schema')

    mockFetch(() => new Response('<html>', { status: 200 }))
    const html = await fetchSnapshot({ host: 'extralife', pid: '2' })
    expect(!html.ok && html.error.kind).toBe('schema')
  })

  test('never fetches for an invalid pid', async () => {
    mockFetch(okRoute)
    const result = await fetchSnapshot({ host: 'extralife', pid: '../events' })
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })
})

describe('parseRetryAfter', () => {
  test('parses seconds and HTTP dates', () => {
    const now = start.getTime()
    expect(parseRetryAfter('120', now)).toBe(120)
    expect(parseRetryAfter('0', now)).toBe(1)
    expect(parseRetryAfter(new Date(now + 45_000).toUTCString(), now)).toBe(45)
    expect(parseRetryAfter('999999', now)).toBe(3600)
    expect(parseRetryAfter('soon', now)).toBeUndefined()
    expect(parseRetryAfter(null, now)).toBeUndefined()
  })
})
