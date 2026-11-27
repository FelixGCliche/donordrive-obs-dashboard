import type { ChannelAuth, ChannelRole } from './channelAuth'
import { generateChannelId, generateCredential, hashCredential } from './channelAuth'
import type { ChannelEnv } from './channelClient'
import { authorizeChannelCall } from './channelClient'
import { CHANNEL_CREDENTIALS_PATH, CHANNEL_INIT_PATH } from './channelPaths'
import { checkRateLimit } from './channelRateLimit'
import { fetchChannel } from './channelStub'

/** A new channel and its plaintext credentials; only their hashes are stored. */
export type CreatedChannel = {
  channelId: string
  ownerKey: string
  subscribeToken: string
}

/** Rate-limit bucket for channel creation by client IP. */
export const createRateLimitKey = (ip: string): string => `create:${ip}`

const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

/** Initializes a fresh channel ID with the hashes; `undefined` when that ID already exists (409). */
const initChannel = async (
  env: ChannelEnv,
  hashes: { ownerHash: string; subscriberHash: string }
): Promise<{ channelId: string } | Response | undefined> => {
  const channelId = generateChannelId()
  const response = await fetchChannel(env, channelId, CHANNEL_INIT_PATH, postJson(hashes))
  if (response.ok) return { channelId }
  return response.status === 409 ? undefined : response
}

/** Creates a channel (rate-limited by `ip`), or returns an error response. */
export const createChannelWith = async (
  env: ChannelEnv,
  ip: string
): Promise<CreatedChannel | Response> => {
  const limited = await checkRateLimit(env.CHANNEL_CREATE_RATE_LIMITER, createRateLimitKey(ip))
  if (limited) return limited

  const ownerKey = generateCredential('owner')
  const subscribeToken = generateCredential('subscriber')
  const hashes = {
    ownerHash: await hashCredential(ownerKey),
    subscriberHash: await hashCredential(subscribeToken),
  }

  // A collision of 128-bit random IDs is near impossible; retry once with a new ID anyway
  const created = (await initChannel(env, hashes)) ?? (await initChannel(env, hashes))
  if (!created) {
    return Response.json(
      { error: 'channel_exists', message: 'Could not allocate a channel ID' },
      { status: 409 }
    )
  }
  if (created instanceof Response) return created
  return { channelId: created.channelId, ownerKey, subscribeToken }
}

/** Replaces the credential of `role`; `auth` must hold the owner key. Returns an error response otherwise. */
export const rotateCredentialWith = async (
  env: ChannelEnv,
  auth: ChannelAuth,
  role: ChannelRole
): Promise<{ credential: string } | Response> => {
  const authorized = await authorizeChannelCall(env, auth.channelId, auth.credential, 'rotate')
  if (authorized instanceof Response) return authorized

  const credential = generateCredential(role)
  const hash = await hashCredential(credential)
  const response = await fetchChannel(
    env,
    auth.channelId,
    CHANNEL_CREDENTIALS_PATH,
    postJson({ role, hash }),
    authorized
  )
  if (!response.ok) return response
  return { credential }
}
