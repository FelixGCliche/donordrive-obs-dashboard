import { describe, expect, mock, test } from 'bun:test'

import type { AllDonationsResult } from '@features/donordrive'

import type { ChannelAction } from './channelAuth'
import { actionFor, can, generateCredential, hashCredential, parseCredential } from './channelAuth'
import { CHANNEL_CREDENTIAL_HASH_HEADER, CHANNEL_ROLE_HEADER } from './channelPaths'
import { channelObjectName } from './channelStub'
import { createFakeChannels, FAKE_MARKS, fakeLimiter } from './fakeDockChannel'
import { CORS_HEADERS, channelSubPath, handleChannelRequest } from './handleChannelRequest'

const okDonations: AllDonationsResult = {
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
  incentives: [{ id: 'I1', description: 'Pick a hero', amount: 5, isActive: true, isTest: false }],
}

const PENDING_QUERY = 'host=extralife&pid=500001'

/** A seeded fake channel plus helpers to send requests to it. */
const setup = async (
  limiters: Parameters<ReturnType<typeof createFakeChannels>['env']>[0] = {}
) => {
  const fake = createFakeChannels()
  const seeded = await fake.seed()
  const env = fake.env(limiters)
  const base = `http://localhost/api/channel/${seeded.channelId}`

  const send = (path: string, init: RequestInit = {}, result: AllDonationsResult = okDonations) => {
    const fetchAllDonations = mock(async () => result)
    const response = handleChannelRequest(
      new Request(`${base}${path}`, init),
      seeded.channelId,
      env,
      { fetchAllDonations }
    )
    return { response, fetchAllDonations }
  }

  return { ...fake, ...seeded, env, base, send }
}

const bearer = (credential: string): RequestInit => ({
  headers: { authorization: `Bearer ${credential}` },
})

describe('channelSubPath', () => {
  const id = 'c'.repeat(22)

  test('returns / for the bare channel ID', () => {
    expect(channelSubPath(`/api/channel/${id}`, id)).toBe('/')
    expect(channelSubPath(`/api/channel/${id}/`, id)).toBe('/')
  })

  test('returns the path after the channel ID', () => {
    expect(channelSubPath(`/api/channel/${id}/events`, id)).toBe('/events')
    expect(channelSubPath(`/api/channel/${id}/marks/`, id)).toBe('/marks')
  })
})

describe('handleChannelRequest routing', () => {
  test('rejects an invalid channel ID before anything else', async () => {
    const { received, env, ownerKey } = await setup()
    const response = await handleChannelRequest(
      new Request('http://localhost/api/channel/short/marks', bearer(ownerKey)),
      'short',
      env
    )
    expect(response.status).toBe(400)
    expect(received).toHaveLength(0)
  })

  test('rejects an unknown or internal sub-path with 404', async () => {
    const { send, ownerKey, received } = await setup()
    for (const path of ['/other', '/init', '/credentials']) {
      const response = await send(path, { method: 'POST', ...bearer(ownerKey) }).response
      expect(response.status).toBe(404)
    }
    expect(received).toHaveLength(0)
  })

  test('rejects a wrong method with 405 and CORS headers', async () => {
    const { send, ownerKey, received } = await setup()
    const events = await send('/events', bearer(ownerKey)).response
    expect(events.status).toBe(405)
    const pending = await send(`/pending?${PENDING_QUERY}`, { method: 'POST', ...bearer(ownerKey) })
      .response
    expect(pending.status).toBe(405)
    expect(pending.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(received).toHaveLength(0)
  })

  test('answers preflights for /pending and /marks without a credential', async () => {
    const { send, received } = await setup()
    for (const path of ['/pending', '/marks']) {
      const response = await send(path, { method: 'OPTIONS' }).response
      expect(response.status).toBe(204)
      for (const [name, value] of Object.entries(CORS_HEADERS)) {
        expect(response.headers.get(name)).toBe(value)
      }
    }
    expect(CORS_HEADERS['Access-Control-Allow-Headers']).toContain('authorization')
    expect(received).toHaveLength(0)
  })
})

type CredentialCase = 'owner' | 'subscriber' | 'rotatedOwner' | 'rotatedSubscriber'
type CredentialCaseAll = CredentialCase | 'wrongRolePrefix' | 'missing' | 'malformed'

const credentialCases: CredentialCaseAll[] = [
  'owner',
  'subscriber',
  'rotatedOwner',
  'rotatedSubscriber',
  'wrongRolePrefix',
  'missing',
  'malformed',
]

type Endpoint = { name: string; path: string; method: string; ws?: boolean; body?: string }

const endpoints: Endpoint[] = [
  { name: 'WS /', path: '/', method: 'GET', ws: true },
  {
    name: 'POST /events',
    path: '/events',
    method: 'POST',
    body: JSON.stringify({ any: 'event' }),
  },
  { name: 'GET /marks', path: '/marks', method: 'GET' },
  {
    name: 'POST /marks',
    path: '/marks',
    method: 'POST',
    body: JSON.stringify({ op: 'read', ids: ['D1'] }),
  },
  { name: 'GET /pending', path: `/pending?${PENDING_QUERY}`, method: 'GET' },
]

const matrix = credentialCases.flatMap((credentialCase) =>
  endpoints.map((endpoint) => [credentialCase, endpoint.name, endpoint] as const)
)

describe('handleChannelRequest auth matrix', () => {
  test.each(matrix)('%s × %s', async (credentialCase, _name, endpoint) => {
    const channel = await setup()
    const credentials: Record<CredentialCaseAll, string | undefined> = {
      owner: channel.ownerKey,
      subscriber: channel.subscribeToken,
      // Well-formed credentials whose hash is no longer stored
      rotatedOwner: generateCredential('owner'),
      rotatedSubscriber: generateCredential('subscriber'),
      wrongRolePrefix: `own_${channel.subscribeToken.slice(4)}`,
      missing: undefined,
      malformed: 'not-a-credential',
    }
    const credential = credentials[credentialCase]

    const subPath = endpoint.path.split('?')[0] ?? '/'
    const action = actionFor(subPath, endpoint.method) as ChannelAction
    const parsed = parseCredential(credential)
    const valid = credentialCase === 'owner' || credentialCase === 'subscriber'
    const expected = !parsed ? 401 : !can(parsed.role, action) ? 403 : valid ? 200 : 401
    const objectCalled = parsed !== undefined && can(parsed.role, action)

    const headers = new Headers()
    let path = endpoint.path
    if (endpoint.ws) {
      headers.set('Upgrade', 'websocket')
      if (credential) path = `${path}?token=${credential}`
    } else if (credential) {
      headers.set('authorization', `Bearer ${credential}`)
    }
    const { response, fetchAllDonations } = channel.send(path, {
      method: endpoint.method,
      headers,
      body: endpoint.body,
    })
    const res = await response

    expect(res.status).toBe(expected)
    expect(channel.received.length > 0).toBe(objectCalled)
    expect(fetchAllDonations).toHaveBeenCalledTimes(
      subPath === '/pending' && expected === 200 ? 1 : 0
    )
    if (expected === 401 && !objectCalled) {
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer')
    }
  })
})

describe('handleChannelRequest forwarding', () => {
  test('overwrites client-sent role and hash headers with the verified ones', async () => {
    const { send, subscribeToken, received } = await setup()
    const response = await send('/marks', {
      headers: {
        authorization: `Bearer ${subscribeToken}`,
        [CHANNEL_ROLE_HEADER]: 'owner',
        [CHANNEL_CREDENTIAL_HASH_HEADER]: 'f'.repeat(64),
      },
    }).response
    expect(response.status).toBe(200)
    const forwarded = received[0]
    expect(forwarded?.headers.get(CHANNEL_ROLE_HEADER)).toBe('subscriber')
    expect(forwarded?.headers.get(CHANNEL_CREDENTIAL_HASH_HEADER)).toBe(
      await hashCredential(subscribeToken)
    )
    expect(forwarded?.headers.get('authorization')).toBeNull()
  })

  test('cannot escalate a subscriber to a write with injected headers', async () => {
    const { send, subscribeToken, ownerKey, received } = await setup()
    const response = await send('/marks', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${subscribeToken}`,
        [CHANNEL_ROLE_HEADER]: 'owner',
        [CHANNEL_CREDENTIAL_HASH_HEADER]: await hashCredential(ownerKey),
      },
      body: JSON.stringify({ op: 'read', ids: ['D1'] }),
    }).response
    expect(response.status).toBe(403)
    expect(received).toHaveLength(0)
  })

  test('strips the token from the forwarded URL and keeps other params', async () => {
    const { send, subscribeToken, received, channelId } = await setup()
    const response = await send(`/?since=abc&token=${subscribeToken}`, {
      headers: { Upgrade: 'websocket' },
    }).response
    expect(response.status).toBe(200)
    const forwarded = received[0]
    expect(forwarded?.objectName).toBe(channelObjectName(channelId))
    expect(forwarded?.url.pathname).toBe('/')
    expect(forwarded?.url.searchParams.has('token')).toBe(false)
    expect(forwarded?.url.searchParams.get('since')).toBe('abc')
  })

  test('accepts ?token= over HTTP when there is no Authorization header', async () => {
    const { send, ownerKey, received } = await setup()
    const response = await send(`/marks?token=${ownerKey}`).response
    expect(response.status).toBe(200)
    expect(received[0]?.url.search).toBe('')
  })

  test('adds CORS headers to forwarded /marks responses', async () => {
    const { send, subscribeToken } = await setup()
    const res = await send('/marks', bearer(subscribeToken)).response
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await res.json()).toEqual(FAKE_MARKS)
  })

  test('adds CORS headers to 401 and 403 responses', async () => {
    const { send, subscribeToken } = await setup()
    const unauthorized = await send('/marks').response
    expect(unauthorized.status).toBe(401)
    const forbidden = await send('/marks', {
      method: 'POST',
      ...bearer(subscribeToken),
      body: '{}',
    }).response
    expect(forbidden.status).toBe(403)
    const rotated = await send(`/pending?${PENDING_QUERY}`, bearer(generateCredential('owner')))
      .response
    expect(rotated.status).toBe(401)
    for (const res of [unauthorized, forbidden, rotated]) {
      for (const [name, value] of Object.entries(CORS_HEADERS)) {
        expect(res.headers.get(name)).toBe(value)
      }
    }
  })
})

describe('handleChannelRequest rate limit', () => {
  test('rejects with 429 and Retry-After without calling the object', async () => {
    const { limiter, keys } = fakeLimiter(false)
    const { send, ownerKey, received, channelId } = await setup({ CHANNEL_RATE_LIMITER: limiter })
    const res = await send('/marks', bearer(ownerKey)).response
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(received).toHaveLength(0)
    expect(keys).toEqual([`${channelId}:owner:${(await hashCredential(ownerKey)).slice(0, 16)}`])
  })

  test('keys subscribers by role and credential fingerprint', async () => {
    const { limiter, keys } = fakeLimiter(true)
    const { send, subscribeToken, channelId } = await setup({ CHANNEL_RATE_LIMITER: limiter })
    const res = await send('/marks', bearer(subscribeToken)).response
    expect(res.status).toBe(200)
    const fingerprint = (await hashCredential(subscribeToken)).slice(0, 16)
    expect(keys).toEqual([`${channelId}:subscriber:${fingerprint}`])
  })

  test('does not consume the limit for a malformed credential', async () => {
    const { limiter, keys } = fakeLimiter(true)
    const { send } = await setup({ CHANNEL_RATE_LIMITER: limiter })
    expect((await send('/marks', bearer('nope')).response).status).toBe(401)
    expect(keys).toHaveLength(0)
  })

  test('allows requests when no limiter is bound', async () => {
    const { send, ownerKey } = await setup()
    expect((await send('/marks', bearer(ownerKey)).response).status).toBe(200)
  })
})

describe('handleChannelRequest /pending', () => {
  test('rejects a bad host, pid or incentive id without calling DonorDrive', async () => {
    const { send, subscribeToken } = await setup()
    const many = Array.from({ length: 11 }, (_, i) => `&incentiveId=I${i}`).join('')
    for (const query of [
      'host=evil&pid=500001',
      'host=extralife',
      'host=extralife&pid=../x',
      `host=extralife&pid=1${many}`,
      'host=extralife&pid=1&incentiveId=',
    ]) {
      const { response, fetchAllDonations } = send(`/pending?${query}`, bearer(subscribeToken))
      expect((await response).status).toBe(400)
      expect(fetchAllDonations).not.toHaveBeenCalled()
    }
  })

  test('reads marks from the object before calling DonorDrive', async () => {
    const { base, channelId, env, subscribeToken, received } = await setup()
    const objectCallsSeen: number[] = []
    const fetchAllDonations = mock(async () => {
      objectCallsSeen.push(received.length)
      return okDonations
    })
    const res = await handleChannelRequest(
      new Request(`${base}/pending?${PENDING_QUERY}`, bearer(subscribeToken)),
      channelId,
      env,
      { fetchAllDonations }
    )
    expect(res.status).toBe(200)
    expect(objectCallsSeen).toEqual([1])
  })

  test('passes a 401 from the object through instead of a 502', async () => {
    const { send } = await setup()
    const { response, fetchAllDonations } = send(
      `/pending?${PENDING_QUERY}`,
      bearer(generateCredential('subscriber'))
    )
    const res = await response
    expect(res.status).toBe(401)
    expect(fetchAllDonations).not.toHaveBeenCalled()
  })

  test('returns unfulfilled redemptions with CORS headers', async () => {
    const { send, subscribeToken, received } = await setup()
    const { response, fetchAllDonations } = send(
      `/pending?${PENDING_QUERY}&incentiveId=I1&token=${subscribeToken}`
    )
    const res = await response
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(received.map((request) => request.url.pathname)).toEqual(['/marks'])
    expect(fetchAllDonations).toHaveBeenCalledWith({ host: 'extralife', pid: '500001' })
    const body = (await res.json()) as { events: { id: string; participantId: string }[] }
    expect(body.events.map((event) => event.id)).toEqual(['incentive.redeemed:D2'])
    expect(body.events[0]?.participantId).toBe('500001')
  })

  test('maps a DonorDrive rate limit to 429 with Retry-After', async () => {
    const { send, subscribeToken } = await setup()
    const res = await send(`/pending?${PENDING_QUERY}`, bearer(subscribeToken), {
      ok: false,
      error: { kind: 'rate_limited', message: 'slow down', retryAfterSec: 30 },
    }).response
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('30')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  test('maps not_found to 404 and other errors to 502', async () => {
    const { send, subscribeToken } = await setup()
    const notFound = await send(`/pending?${PENDING_QUERY}`, bearer(subscribeToken), {
      ok: false,
      error: { kind: 'not_found', message: 'nope' },
    }).response
    expect(notFound.status).toBe(404)
    const upstream = await send(`/pending?${PENDING_QUERY}`, bearer(subscribeToken), {
      ok: false,
      error: { kind: 'schema', message: 'bad' },
    }).response
    expect(upstream.status).toBe(502)
  })
})
