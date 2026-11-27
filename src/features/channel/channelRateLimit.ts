/** Shape of a Workers Rate Limiting binding. */
export type RateLimiter = {
  limit: (options: { key: string }) => Promise<{ success: boolean }>
}

/** Matches the binding's 60 s period. */
export const RATE_LIMIT_RETRY_AFTER_SECONDS = 60

/** A 429 response when `limiter` rejects `key`; `undefined` when allowed or no limiter is bound. */
export const checkRateLimit = async (
  limiter: RateLimiter | undefined,
  key: string
): Promise<Response | undefined> => {
  if (!limiter) return undefined
  const { success } = await limiter.limit({ key })
  if (success) return undefined
  return Response.json(
    { error: 'rate_limited', message: 'Too many requests' },
    { status: 429, headers: { 'Retry-After': String(RATE_LIMIT_RETRY_AFTER_SECONDS) } }
  )
}
