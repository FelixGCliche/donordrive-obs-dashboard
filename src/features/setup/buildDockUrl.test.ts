import { describe, expect, test } from 'bun:test'

import { dockSearchSchema } from '@features/dock'

import { buildChannelUrl, buildDockUrl } from './buildDockUrl'

const KEY = 'AbCdEfGhIjKlMnOpQrSt_-'

describe('buildDockUrl', () => {
  test('includes every set field in a stable order', () => {
    const url = buildDockUrl('https://dock.example.com', {
      pid: '12345',
      host: 'extralife',
      interval: 30,
      theme: 'dark',
      density: 'compact',
      key: KEY,
    })
    expect(url).toBe(
      `https://dock.example.com/dock?pid=12345&host=extralife&interval=30&theme=dark&density=compact&key=${KEY}`
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
    const search = dockSearchSchema.parse({ pid: 'abc-1', interval: '60', key: KEY })
    const params = Object.fromEntries(new URL(buildDockUrl('https://x.dev', search)).searchParams)
    expect(dockSearchSchema.parse(params)).toEqual(search)
  })
})

describe('buildChannelUrl', () => {
  test('uses wss for https origins', () => {
    expect(buildChannelUrl('https://dock.example.com', KEY, '42')).toBe(
      `wss://dock.example.com/api/channel/${KEY}?incentive=42`
    )
  })

  test('uses ws for http origins', () => {
    expect(buildChannelUrl('http://localhost:3000', KEY, 'abc')).toBe(
      `ws://localhost:3000/api/channel/${KEY}?incentive=abc`
    )
  })

  test('omits the incentive when none is chosen', () => {
    expect(buildChannelUrl('https://dock.example.com', KEY)).toBe(
      `wss://dock.example.com/api/channel/${KEY}`
    )
  })
})
