import { describe, expect, mock, test } from 'bun:test'

import type { AllDonationsResult } from '@features/donordrive'

import type { ChannelEnv } from './channelClient'
import { CORS_HEADERS, channelSubPath, handleChannelRequest } from './handleChannelRequest'

const key = 'k'.repeat(22)

describe('channelSubPath', () => {
  test('returns / for the bare key', () => {
    expect(channelSubPath(`/api/channel/${key}`, key)).toBe('/')
    expect(channelSubPath(`/api/channel/${key}/`, key)).toBe('/')
  })

  test('returns the path after the key', () => {
    expect(channelSubPath(`/api/channel/${key}/events`, key)).toBe('/events')
    expect(channelSubPath(`/api/channel/${key}/marks/`, key)).toBe('/marks')
  })
})

describe('handleChannelRequest', () => {
  const env = {} as ChannelEnv

  test('rejects an invalid key', async () => {
    const response = await handleChannelRequest(
      new Request('http://localhost/api/channel/short'),
      'short',
      env
    )
    expect(response.status).toBe(400)
  })

  test('rejects an unknown sub-path', async () => {
    const response = await handleChannelRequest(
      new Request(`http://localhost/api/channel/${key}/other`),
      key,
      env
    )
    expect(response.status).toBe(404)
  })
})

describe('handleChannelRequest /pending', () => {
  const marks = { version: 2, read: [], fulfilled: ['D1'], baselined: true }
  const channelFetch = mock(async (_request: Request) => Response.json(marks))
  const env = {
    DOCK_CHANNEL: { idFromName: () => 'id', get: () => ({ fetch: channelFetch }) },
  } as unknown as ChannelEnv

  const ok: AllDonationsResult = {
    ok: true,
    participantId: '500001',
    donations: [
      {
        id: 'D2',
        displayName: 'Ana',
        amount: 25,
        createdAt: '2026-11-07T18:02:00.000Z',
        incentiveId: 'I1',
        isTest: false,
      },
      {
        id: 'D1',
        displayName: 'Bo',
        amount: 10,
        createdAt: '2026-11-07T18:01:00.000Z',
        incentiveId: 'I1',
        isTest: false,
      },
    ],
    incentives: [
      { id: 'I1', description: 'Pick a hero', amount: 5, isActive: true, isTest: false },
    ],
  }

  const pending = (query: string, init?: RequestInit, result: AllDonationsResult = ok) => {
    const fetchAllDonations = mock(async () => result)
    const response = handleChannelRequest(
      new Request(`http://localhost/api/channel/${key}/pending${query}`, init),
      key,
      env,
      { fetchAllDonations }
    )
    return { response, fetchAllDonations }
  }

  test('rejects a bad host', async () => {
    const { response, fetchAllDonations } = pending('?host=evil&pid=500001')
    expect((await response).status).toBe(400)
    expect(fetchAllDonations).not.toHaveBeenCalled()
  })

  test('rejects a missing or bad pid', async () => {
    expect((await pending('?host=extralife').response).status).toBe(400)
    expect((await pending('?host=extralife&pid=../x').response).status).toBe(400)
  })

  test('rejects too many or invalid incentive ids', async () => {
    const many = Array.from({ length: 11 }, (_, i) => `&incentiveId=I${i}`).join('')
    expect((await pending(`?host=extralife&pid=1${many}`).response).status).toBe(400)
    expect((await pending('?host=extralife&pid=1&incentiveId=').response).status).toBe(400)
  })

  test('returns unfulfilled redemptions with CORS headers', async () => {
    const { response, fetchAllDonations } = pending('?host=extralife&pid=500001&incentiveId=I1')
    const res = await response
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(fetchAllDonations).toHaveBeenCalledWith({ host: 'extralife', pid: '500001' })
    const body = (await res.json()) as { events: { id: string; participantId: string }[] }
    expect(body.events.map((event) => event.id)).toEqual(['incentive.redeemed:D2'])
    expect(body.events[0]?.participantId).toBe('500001')
  })

  test('maps a rate limit to 429 with Retry-After', async () => {
    const res = await pending('?host=extralife&pid=500001', undefined, {
      ok: false,
      error: { kind: 'rate_limited', message: 'slow down', retryAfterSec: 30 },
    }).response
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('30')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  test('maps not_found to 404 and other errors to 502', async () => {
    const notFound = await pending('?host=extralife&pid=500001', undefined, {
      ok: false,
      error: { kind: 'not_found', message: 'nope' },
    }).response
    expect(notFound.status).toBe(404)
    const upstream = await pending('?host=extralife&pid=500001', undefined, {
      ok: false,
      error: { kind: 'schema', message: 'bad' },
    }).response
    expect(upstream.status).toBe(502)
  })

  test('answers preflights for /pending and /marks', async () => {
    for (const path of ['pending', 'marks']) {
      const res = await handleChannelRequest(
        new Request(`http://localhost/api/channel/${key}/${path}`, { method: 'OPTIONS' }),
        key,
        env
      )
      expect(res.status).toBe(204)
      for (const [name, value] of Object.entries(CORS_HEADERS)) {
        expect(res.headers.get(name)).toBe(value)
      }
    }
  })

  test('adds CORS headers to forwarded /marks responses', async () => {
    const res = await handleChannelRequest(
      new Request(`http://localhost/api/channel/${key}/marks`),
      key,
      env
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await res.json()).toEqual(marks)
  })
})
