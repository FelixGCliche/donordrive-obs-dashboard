import type { DurableObjectNamespace } from '@cloudflare/workers-types'

import type { ChannelAction, ChannelAuth, ChannelRole } from './channelAuth'
import { actionFor, can, CHANNEL_ID_PATTERN, hashCredential, parseCredential } from './channelAuth'
import type { RateLimiter } from './channelRateLimit'
import { checkRateLimit } from './channelRateLimit'
import type { ForwardedAuth } from './channelStub'
import { fetchChannel } from './channelStub'

export type ChannelEnv = {
  DOCK_CHANNEL: DurableObjectNamespace
  CHANNEL_RATE_LIMITER?: RateLimiter
  CHANNEL_CREATE_RATE_LIMITER?: RateLimiter
}

export type ChannelPath = '/events' | '/marks'

/** 401 for a missing, malformed, wrong or rotated credential. */
export const unauthorizedResponse = (): Response =>
  Response.json(
    { error: 'unauthorized', message: 'Missing or invalid channel credential' },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } }
  )

/** 403 for a valid credential whose role may not perform the action. */
export const forbiddenResponse = (): Response =>
  Response.json(
    { error: 'forbidden', message: 'This credential may not perform this action' },
    { status: 403 }
  )

/** Rate-limit bucket of a credential; the hash prefix keeps fake credentials in their own bucket. */
export const channelRateLimitKey = (channelId: string, role: ChannelRole, hash: string): string =>
  `${channelId}:${role}:${hash.slice(0, 16)}`

/**
 * Worker-side checks shared by every channel call: channel ID format (400), credential format
 * (401), role permission (403, the DO is not called) and rate limit (429). Returns the role and
 * credential hash to forward to the DO, which verifies the hash.
 */
export const authorizeChannelCall = async (
  env: ChannelEnv,
  channelId: string,
  credential: unknown,
  action: ChannelAction
): Promise<ForwardedAuth | Response> => {
  if (!CHANNEL_ID_PATTERN.test(channelId)) {
    return Response.json(
      { error: 'invalid_channel', message: 'Invalid channel ID' },
      { status: 400 }
    )
  }
  const parsed = parseCredential(credential)
  if (!parsed) return unauthorizedResponse()
  if (!can(parsed.role, action)) return forbiddenResponse()

  const hash = await hashCredential(parsed.credential)
  const limited = await checkRateLimit(
    env.CHANNEL_RATE_LIMITER,
    channelRateLimitKey(channelId, parsed.role, hash)
  )
  if (limited) return limited
  return { role: parsed.role, hash }
}

/** Server-side call into the DockChannel Durable Object for `auth.channelId`. */
export const callChannel = async (
  env: ChannelEnv,
  auth: ChannelAuth,
  path: ChannelPath,
  init?: RequestInit
): Promise<Response> => {
  const action = actionFor(path, init?.method ?? 'GET')
  if (!action) return new Response('Not found', { status: 404 })
  if (action === 'method_not_allowed') return new Response('Method not allowed', { status: 405 })

  const authorized = await authorizeChannelCall(env, auth.channelId, auth.credential, action)
  if (authorized instanceof Response) return authorized
  return fetchChannel(env, auth.channelId, path, init, authorized)
}
