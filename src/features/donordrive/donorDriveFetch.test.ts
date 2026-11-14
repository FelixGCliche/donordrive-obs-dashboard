import { describe, expect, mock, test } from 'bun:test'

import {
  DEFAULT_RETRY_AFTER_SEC,
  DONORDRIVE_USER_AGENT,
  etagsDiffer,
  fetchDonorDrive,
  MAX_RETRY_AFTER_SEC,
  parseRetryAfter,
  type UpstreamDeps,
} from './donorDriveFetch'

const URL_ = 'https://www.extra-life.org/api/participants/500001'
const NOW = Date.parse('2026-11-11T12:00:00.000Z')

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })

const makeDeps = (respond: () => Response | Promise<Response>) => {
  const fetch = mock(async (_input: string, _init?: RequestInit) => respond())
  const deps: UpstreamDeps = { fetch, now: () => NOW }
  return { deps, fetch }
}

const headersOf = (init?: RequestInit) => new Headers(init?.headers)

describe('parseRetryAfter', () => {
  test('parses delta seconds', () => {
    expect(parseRetryAfter('120', NOW)).toBe(120)
    expect(parseRetryAfter(' 5 ', NOW)).toBe(5)
  })

  test('parses an HTTP date relative to now', () => {
    expect(parseRetryAfter(new Date(NOW + 30_000).toUTCString(), NOW)).toBe(30)
  })

  test('returns undefined for missing or invalid values', () => {
    expect(parseRetryAfter(null, NOW)).toBeUndefined()
    expect(parseRetryAfter('', NOW)).toBeUndefined()
    expect(parseRetryAfter('soon', NOW)).toBeUndefined()
  })

  test('clamps to between 1 second and the max', () => {
    expect(parseRetryAfter('0', NOW)).toBe(1)
    expect(parseRetryAfter(new Date(NOW - 60_000).toUTCString(), NOW)).toBe(1)
    expect(parseRetryAfter('999999', NOW)).toBe(MAX_RETRY_AFTER_SEC)
  })
})

describe('fetchDonorDrive', () => {
  test('sends Accept, User-Agent and the signal, without If-None-Match', async () => {
    const { deps, fetch } = makeDeps(() => json({ a: 1 }))
    const signal = new AbortController().signal
    await fetchDonorDrive(URL_, deps, { signal })

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(URL_)
    expect(init?.signal).toBe(signal)
    const headers = headersOf(init)
    expect(headers.get('Accept')).toBe('application/json')
    expect(headers.get('User-Agent')).toBe(DONORDRIVE_USER_AGENT)
    expect(headers.has('If-None-Match')).toBe(false)
  })

  test('sends If-None-Match verbatim when an etag is given', async () => {
    const { deps, fetch } = makeDeps(() => json({}))
    await fetchDonorDrive(URL_, deps, { etag: 'W/"abc"' })
    expect(headersOf(fetch.mock.calls[0][1]).get('If-None-Match')).toBe('W/"abc"')
  })

  test('maps 304 to not_modified', async () => {
    const { deps } = makeDeps(() => new Response(null, { status: 304 }))
    expect(await fetchDonorDrive(URL_, deps, { etag: '"abc"' })).toEqual({
      status: 'not_modified',
    })
  })

  test('maps 204 (empty result or offset out of range) to an empty array', async () => {
    const { deps } = makeDeps(() => new Response(null, { status: 204 }))
    expect(await fetchDonorDrive(URL_, deps)).toEqual({ status: 'ok', data: [] })
  })

  test('maps 404 to not_found', async () => {
    const { deps } = makeDeps(() => new Response('nope', { status: 404 }))
    expect(await fetchDonorDrive(URL_, deps)).toEqual({
      status: 'error',
      error: { kind: 'not_found', message: 'Participant not found' },
    })
  })

  test('maps 429 with Retry-After to rate_limited', async () => {
    const { deps } = makeDeps(
      () => new Response(null, { status: 429, headers: { 'Retry-After': '42' } })
    )
    expect(await fetchDonorDrive(URL_, deps)).toEqual({
      status: 'error',
      error: { kind: 'rate_limited', message: 'DonorDrive rate limit reached', retryAfterSec: 42 },
    })
  })

  test('uses deps.now for an HTTP-date Retry-After', async () => {
    const { deps } = makeDeps(
      () =>
        new Response(null, {
          status: 429,
          headers: { 'Retry-After': new Date(NOW + 90_000).toUTCString() },
        })
    )
    const result = await fetchDonorDrive(URL_, deps)
    expect(result.status === 'error' && result.error.retryAfterSec).toBe(90)
  })

  test('falls back to the default wait when a 429 has no Retry-After', async () => {
    const { deps } = makeDeps(() => new Response(null, { status: 429 }))
    const result = await fetchDonorDrive(URL_, deps)
    expect(result).toEqual({
      status: 'error',
      error: {
        kind: 'rate_limited',
        message: 'DonorDrive rate limit reached',
        retryAfterSec: DEFAULT_RETRY_AFTER_SEC,
      },
    })
  })

  test('maps other non-ok statuses to upstream', async () => {
    const { deps } = makeDeps(() => new Response('down', { status: 503 }))
    expect(await fetchDonorDrive(URL_, deps)).toEqual({
      status: 'error',
      error: { kind: 'upstream', message: 'DonorDrive responded with 503' },
    })
  })

  test('maps a network error to upstream', async () => {
    const { deps } = makeDeps(() => {
      throw new TypeError('fetch failed')
    })
    expect(await fetchDonorDrive(URL_, deps)).toEqual({
      status: 'error',
      error: { kind: 'upstream', message: 'Could not reach DonorDrive' },
    })
  })

  test('maps a TimeoutError to a timeout message', async () => {
    const { deps } = makeDeps(() => {
      throw new DOMException('timed out', 'TimeoutError')
    })
    expect(await fetchDonorDrive(URL_, deps)).toEqual({
      status: 'error',
      error: { kind: 'upstream', message: 'DonorDrive did not respond in time' },
    })
  })

  test('maps invalid JSON to schema', async () => {
    const { deps } = makeDeps(() => new Response('<html>', { status: 200 }))
    expect(await fetchDonorDrive(URL_, deps)).toEqual({
      status: 'error',
      error: { kind: 'schema', message: 'DonorDrive returned invalid JSON' },
    })
  })

  test('returns data with the ETag header', async () => {
    const { deps } = makeDeps(() => json({ a: 1 }, { headers: { ETag: 'W/"v1"' } }))
    expect(await fetchDonorDrive(URL_, deps)).toEqual({
      status: 'ok',
      data: { a: 1 },
      etag: 'W/"v1"',
    })
  })

  test('omits etag when the header is absent', async () => {
    const { deps } = makeDeps(() => json([1, 2]))
    const result = await fetchDonorDrive(URL_, deps)
    expect(result).toEqual({ status: 'ok', data: [1, 2] })
    expect('etag' in result).toBe(false)
  })
})

describe('etagsDiffer', () => {
  test('treats weak and strong forms of the same value as equal', () => {
    expect(etagsDiffer('W/"abc"', '"abc"')).toBe(false)
    expect(etagsDiffer('"abc"', ' abc ')).toBe(false)
  })

  test('detects different values', () => {
    expect(etagsDiffer('"abc"', '"def"')).toBe(true)
    expect(etagsDiffer('W/"abc"', 'W/"def"')).toBe(true)
  })

  test('returns false when either side is missing', () => {
    expect(etagsDiffer(undefined, '"abc"')).toBe(false)
    expect(etagsDiffer('"abc"', undefined)).toBe(false)
    expect(etagsDiffer(undefined, undefined)).toBe(false)
  })
})
