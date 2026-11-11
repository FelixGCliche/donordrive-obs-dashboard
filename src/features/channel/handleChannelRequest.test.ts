import { describe, expect, test } from 'bun:test'

import type { ChannelEnv } from './channelClient'
import { channelSubPath, handleChannelRequest } from './handleChannelRequest'

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
