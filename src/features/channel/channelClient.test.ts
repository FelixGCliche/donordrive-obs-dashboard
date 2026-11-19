import { describe, expect, test } from 'bun:test'

import { hashCredential } from './channelAuth'
import { authorizeChannelCall, callChannel } from './channelClient'
import { CHANNEL_CREDENTIAL_HASH_HEADER, CHANNEL_ROLE_HEADER } from './channelPaths'
import { createFakeChannels, FAKE_MARKS, fakeLimiter } from './fakeDockChannel'

const markOp = {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ op: 'read', ids: ['D1'] }),
}

describe('callChannel', () => {
  test('forwards an owner marks write with the verified role and hash', async () => {
    const fake = createFakeChannels()
    const { channelId, ownerKey } = await fake.seed()
    const response = await callChannel(
      fake.env(),
      { channelId, credential: ownerKey },
      '/marks',
      markOp
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(FAKE_MARKS)
    const forwarded = fake.received[0]
    expect(forwarded?.method).toBe('POST')
    expect(forwarded?.headers.get(CHANNEL_ROLE_HEADER)).toBe('owner')
    expect(forwarded?.headers.get(CHANNEL_CREDENTIAL_HASH_HEADER)).toBe(
      await hashCredential(ownerKey)
    )
  })

  test('lets a subscribe token read marks', async () => {
    const fake = createFakeChannels()
    const { channelId, subscribeToken } = await fake.seed()
    const response = await callChannel(
      fake.env(),
      { channelId, credential: subscribeToken },
      '/marks'
    )
    expect(response.status).toBe(200)
  })

  test('refuses a subscribe token on a marks write with 403 without calling the object', async () => {
    const fake = createFakeChannels()
    const { channelId, subscribeToken } = await fake.seed()
    const response = await callChannel(
      fake.env(),
      { channelId, credential: subscribeToken },
      '/marks',
      markOp
    )
    expect(response.status).toBe(403)
    expect(fake.received).toHaveLength(0)
  })

  test('refuses a malformed credential with 401 and WWW-Authenticate', async () => {
    const fake = createFakeChannels()
    const { channelId } = await fake.seed()
    const response = await callChannel(fake.env(), { channelId, credential: 'nope' }, '/marks')
    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toBe('Bearer')
    expect(fake.received).toHaveLength(0)
  })

  test('refuses an invalid channel ID with 400', async () => {
    const fake = createFakeChannels()
    const { ownerKey } = await fake.seed()
    const response = await callChannel(
      fake.env(),
      { channelId: 'short', credential: ownerKey },
      '/marks'
    )
    expect(response.status).toBe(400)
    expect(fake.received).toHaveLength(0)
  })

  test('answers 429 when rate-limited, without calling the object', async () => {
    const fake = createFakeChannels()
    const { channelId, ownerKey } = await fake.seed()
    const { limiter, keys } = fakeLimiter(false)
    const response = await callChannel(
      fake.env({ CHANNEL_RATE_LIMITER: limiter }),
      { channelId, credential: ownerKey },
      '/marks'
    )
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(keys).toEqual([`${channelId}:owner:${(await hashCredential(ownerKey)).slice(0, 16)}`])
    expect(fake.received).toHaveLength(0)
  })

  test('answers 405 for a GET on /events', async () => {
    const fake = createFakeChannels()
    const { channelId, ownerKey } = await fake.seed()
    const response = await callChannel(fake.env(), { channelId, credential: ownerKey }, '/events')
    expect(response.status).toBe(405)
  })
})

describe('authorizeChannelCall', () => {
  test('returns the role and hash of an allowed credential', async () => {
    const fake = createFakeChannels()
    const { channelId, subscribeToken } = await fake.seed()
    expect(await authorizeChannelCall(fake.env(), channelId, subscribeToken, 'subscribe')).toEqual({
      role: 'subscriber',
      hash: await hashCredential(subscribeToken),
    })
  })
})
