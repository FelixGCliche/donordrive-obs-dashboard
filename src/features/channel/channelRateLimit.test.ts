import { describe, expect, test } from 'bun:test'

import type { RateLimiter } from './channelRateLimit'
import { checkRateLimit, RATE_LIMIT_RETRY_AFTER_SECONDS } from './channelRateLimit'

const limiter = (success: boolean) => {
  const keys: string[] = []
  const value: RateLimiter = {
    limit: async ({ key }) => {
      keys.push(key)
      return { success }
    },
  }
  return { value, keys }
}

describe('checkRateLimit', () => {
  test('allows every request when no limiter is bound', async () => {
    expect(await checkRateLimit(undefined, 'k')).toBeUndefined()
  })

  test('allows a request the limiter accepts', async () => {
    const { value, keys } = limiter(true)
    expect(await checkRateLimit(value, 'chan:owner:abc')).toBeUndefined()
    expect(keys).toEqual(['chan:owner:abc'])
  })

  test('answers 429 with Retry-After when the limiter rejects', async () => {
    const { value } = limiter(false)
    const response = await checkRateLimit(value, 'k')
    expect(response?.status).toBe(429)
    expect(response?.headers.get('Retry-After')).toBe(String(RATE_LIMIT_RETRY_AFTER_SECONDS))
    expect(await response?.json()).toEqual({
      error: 'rate_limited',
      message: 'Too many requests',
    })
  })
})
