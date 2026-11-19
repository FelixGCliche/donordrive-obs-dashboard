import { describe, expect, test } from 'bun:test'

import type { CreatedChannel } from './channelAdmin'
import { createChannelWith, rotateCredentialWith } from './channelAdmin'
import {
  CHANNEL_ID_PATTERN,
  hashCredential,
  OWNER_KEY_PATTERN,
  SUBSCRIBE_TOKEN_PATTERN,
} from './channelAuth'
import { callChannel } from './channelClient'
import { CHANNEL_CREDENTIALS_PATH, CHANNEL_INIT_PATH } from './channelPaths'
import { channelObjectName } from './channelStub'
import { createFakeChannels, fakeLimiter } from './fakeDockChannel'

const expectCreated = (result: CreatedChannel | Response): CreatedChannel => {
  if (result instanceof Response) throw new Error(`Expected a channel, got ${result.status}`)
  return result
}

describe('createChannelWith', () => {
  test('returns plaintext credentials but sends only their hashes to /init', async () => {
    const fake = createFakeChannels()
    const created = expectCreated(await createChannelWith(fake.env(), '203.0.113.7'))

    expect(created.channelId).toMatch(CHANNEL_ID_PATTERN)
    expect(created.ownerKey).toMatch(OWNER_KEY_PATTERN)
    expect(created.subscribeToken).toMatch(SUBSCRIBE_TOKEN_PATTERN)

    expect(fake.received).toHaveLength(1)
    const init = fake.received[0]
    expect(init?.url.pathname).toBe(CHANNEL_INIT_PATH)
    expect(init?.method).toBe('POST')
    expect(init?.objectName).toBe(channelObjectName(created.channelId))
    expect(JSON.parse(init?.body ?? '')).toEqual({
      ownerHash: await hashCredential(created.ownerKey),
      subscriberHash: await hashCredential(created.subscribeToken),
    })
    expect(init?.body).not.toContain(created.ownerKey.slice(4))
    expect(init?.body).not.toContain(created.subscribeToken.slice(4))
  })

  test('the created credentials work against the channel', async () => {
    const fake = createFakeChannels()
    const created = expectCreated(await createChannelWith(fake.env(), '203.0.113.7'))
    const response = await callChannel(
      fake.env(),
      { channelId: created.channelId, credential: created.subscribeToken },
      '/marks'
    )
    expect(response.status).toBe(200)
  })

  test('retries once with a new ID when /init answers 409', async () => {
    const fake = createFakeChannels()
    fake.options.initConflicts = 1
    const created = expectCreated(await createChannelWith(fake.env(), '203.0.113.7'))
    expect(fake.received).toHaveLength(2)
    const [first, second] = fake.received
    expect(first?.objectName).not.toBe(second?.objectName)
    expect(second?.objectName).toBe(channelObjectName(created.channelId))
  })

  test('gives up after a second 409', async () => {
    const fake = createFakeChannels()
    fake.options.initConflicts = 2
    const result = await createChannelWith(fake.env(), '203.0.113.7')
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(409)
    expect(fake.received).toHaveLength(2)
  })

  test('is rate-limited by IP', async () => {
    const fake = createFakeChannels()
    const { limiter, keys } = fakeLimiter(false)
    const result = await createChannelWith(
      fake.env({ CHANNEL_CREATE_RATE_LIMITER: limiter }),
      '203.0.113.7'
    )
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(429)
    expect((result as Response).headers.get('Retry-After')).toBe('60')
    expect(keys).toEqual(['create:203.0.113.7'])
    expect(fake.received).toHaveLength(0)
  })
})

describe('rotateCredentialWith', () => {
  test('refuses a subscribe token with 403 without calling the object', async () => {
    const fake = createFakeChannels()
    const { channelId, subscribeToken } = await fake.seed()
    const result = await rotateCredentialWith(
      fake.env(),
      { channelId, credential: subscribeToken },
      'subscriber'
    )
    expect((result as Response).status).toBe(403)
    expect(fake.received).toHaveLength(0)
  })

  test('refuses a wrong owner key with 401', async () => {
    const fake = createFakeChannels()
    const { channelId } = await fake.seed()
    const result = await rotateCredentialWith(
      fake.env(),
      { channelId, credential: `own_${'A'.repeat(43)}` },
      'subscriber'
    )
    expect((result as Response).status).toBe(401)
  })

  test('replaces the subscribe token; the old one then gets 401', async () => {
    const fake = createFakeChannels()
    const { channelId, ownerKey, subscribeToken } = await fake.seed()
    const env = fake.env()

    const result = await rotateCredentialWith(
      env,
      { channelId, credential: ownerKey },
      'subscriber'
    )
    if (result instanceof Response) throw new Error(`Rotation failed: ${result.status}`)
    expect(result.credential).toMatch(SUBSCRIBE_TOKEN_PATTERN)
    expect(result.credential).not.toBe(subscribeToken)

    const update = fake.received.at(-1)
    expect(update?.url.pathname).toBe(CHANNEL_CREDENTIALS_PATH)
    expect(JSON.parse(update?.body ?? '')).toEqual({
      role: 'subscriber',
      hash: await hashCredential(result.credential),
    })

    const old = await callChannel(env, { channelId, credential: subscribeToken }, '/marks')
    expect(old.status).toBe(401)
    const fresh = await callChannel(env, { channelId, credential: result.credential }, '/marks')
    expect(fresh.status).toBe(200)
    const owner = await callChannel(env, { channelId, credential: ownerKey }, '/marks')
    expect(owner.status).toBe(200)
  })

  test('replaces the owner key; the old one then gets 401', async () => {
    const fake = createFakeChannels()
    const { channelId, ownerKey } = await fake.seed()
    const env = fake.env()

    const result = await rotateCredentialWith(env, { channelId, credential: ownerKey }, 'owner')
    if (result instanceof Response) throw new Error(`Rotation failed: ${result.status}`)
    expect(result.credential).toMatch(OWNER_KEY_PATTERN)

    const again = await rotateCredentialWith(env, { channelId, credential: ownerKey }, 'owner')
    expect((again as Response).status).toBe(401)
    const fresh = await callChannel(env, { channelId, credential: result.credential }, '/marks')
    expect(fresh.status).toBe(200)
  })
})
