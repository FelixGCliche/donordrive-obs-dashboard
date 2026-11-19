import type { ChannelRole } from './channelAuth'
import type { ChannelEnv } from './channelClient'
import { CHANNEL_CREDENTIAL_HASH_HEADER, CHANNEL_ORIGIN, CHANNEL_ROLE_HEADER } from './channelPaths'

/** Public sub-paths a DockChannel object serves. Internal paths (`/init`, `/credentials`) are not listed. */
export const channelSubPaths = ['/', '/events', '/marks'] as const

export type ChannelSubPath = (typeof channelSubPaths)[number]

export const isChannelSubPath = (path: string): path is ChannelSubPath =>
  (channelSubPaths as readonly string[]).includes(path)

/** Role and credential hash the Worker verified; the DO compares the hash with its stored one. */
export type ForwardedAuth = {
  role: ChannelRole
  hash: string
}

/** Durable Object name of a channel. The prefix keeps old dock-key objects unreachable. */
export const channelObjectName = (channelId: string): string => `channel:${channelId}`

/**
 * Sends a request to the DockChannel object of `channelId`; `pathAndQuery` starts with `/`.
 * Client-sent auth headers and the plaintext credential are always dropped; the role and hash
 * headers are set only from `auth`.
 */
export const fetchChannel = (
  env: ChannelEnv,
  channelId: string,
  pathAndQuery: string,
  init?: RequestInit,
  auth?: ForwardedAuth
): Promise<Response> => {
  const request = new Request(`${CHANNEL_ORIGIN}${pathAndQuery}`, init)
  request.headers.delete(CHANNEL_ROLE_HEADER)
  request.headers.delete(CHANNEL_CREDENTIAL_HASH_HEADER)
  request.headers.delete('authorization')
  if (auth) {
    request.headers.set(CHANNEL_ROLE_HEADER, auth.role)
    request.headers.set(CHANNEL_CREDENTIAL_HASH_HEADER, auth.hash)
  }
  const stub = env.DOCK_CHANNEL.get(env.DOCK_CHANNEL.idFromName(channelObjectName(channelId)))
  // Worker and DOM Request/Response types differ only nominally
  return stub.fetch(request as never) as unknown as Promise<Response>
}
