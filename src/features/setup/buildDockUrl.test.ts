import { describe, expect, test } from 'bun:test'

import { dockSearchSchema } from '@features/dock'

import { buildChannelUrl, buildDockUrl } from './buildDockUrl'

const CHANNEL_ID = 'AbCdEfGhIjKlMnOpQrSt_-'
const OWNER_KEY = `own_${'a'.repeat(43)}`
const SUBSCRIBE_TOKEN = `sub_${'b'.repeat(43)}`

describe('buildDockUrl', () => {
  test('includes every set field in a stable order', () => {
    const url = buildDockUrl('https://dock.example.com', {
      pid: '12345',
      host: 'extralife',
      interval: 30,
      theme: 'dark',
      density: 'compact',
      channel: CHANNEL_ID,
      key: OWNER_KEY,
    })
    expect(url).toBe(
      `https://dock.example.com/dock?pid=12345&host=extralife&interval=30&theme=dark&density=compact&channel=${CHANNEL_ID}&key=${OWNER_KEY}`
    )
  })

  test('omits undefined fields', () => {
    const url = buildDockUrl('http://localhost:3000', {
      host: 'try',
      interval: 15,
      theme: 'light',
      density: 'comfortable',
    })
    expect(url).toBe(
      'http://localhost:3000/dock?host=try&interval=15&theme=light&density=comfortable'
    )
  })

  test('ignores a path or trailing slash on the origin', () => {
    const url = buildDockUrl('https://dock.example.com/setup/', dockSearchSchema.parse({}))
    expect(url.startsWith('https://dock.example.com/dock?')).toBe(true)
  })

  test('round-trips through the dock search schema', () => {
    const search = dockSearchSchema.parse({
      pid: 'abc-1',
      interval: '60',
      channel: CHANNEL_ID,
      key: OWNER_KEY,
    })
    const params = Object.fromEntries(new URL(buildDockUrl('https://x.dev', search)).searchParams)
    expect(params.channel).toBe(CHANNEL_ID)
    expect(params.key).toBe(OWNER_KEY)
    expect(dockSearchSchema.parse(params)).toEqual(search)
  })
})

describe('buildChannelUrl', () => {
  test('uses wss for https origins', () => {
    expect(buildChannelUrl('https://dock.example.com', CHANNEL_ID, SUBSCRIBE_TOKEN)).toBe(
      `wss://dock.example.com/api/channel/${CHANNEL_ID}?token=${SUBSCRIBE_TOKEN}`
    )
  })

  test('uses ws for http origins', () => {
    expect(buildChannelUrl('http://localhost:3000', CHANNEL_ID, SUBSCRIBE_TOKEN)).toBe(
      `ws://localhost:3000/api/channel/${CHANNEL_ID}?token=${SUBSCRIBE_TOKEN}`
    )
  })

  test('has only the token without a participant and ignores the origin path', () => {
    const url = new URL(
      buildChannelUrl('https://dock.example.com/setup?x=1', CHANNEL_ID, SUBSCRIBE_TOKEN)
    )
    expect([...url.searchParams.keys()]).toEqual(['token'])
    expect(url.pathname).toBe(`/api/channel/${CHANNEL_ID}`)
  })

  test('appends host and pid after the token when given', () => {
    expect(
      buildChannelUrl('https://dock.example.com', CHANNEL_ID, SUBSCRIBE_TOKEN, {
        host: 'extralife',
        pid: '12345',
      })
    ).toBe(
      `wss://dock.example.com/api/channel/${CHANNEL_ID}?token=${SUBSCRIBE_TOKEN}&host=extralife&pid=12345`
    )
  })

  test('skips a missing pid', () => {
    expect(
      buildChannelUrl('http://localhost:3000', CHANNEL_ID, SUBSCRIBE_TOKEN, { host: 'try' })
    ).toBe(`ws://localhost:3000/api/channel/${CHANNEL_ID}?token=${SUBSCRIBE_TOKEN}&host=try`)
  })
})
