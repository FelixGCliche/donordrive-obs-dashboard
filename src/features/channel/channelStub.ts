import type { ChannelEnv } from './channelClient'
import { CHANNEL_ORIGIN, DOCK_KEY_HEADER } from './channelPaths'

/** Sub-paths a DockChannel object serves. */
export const channelSubPaths = ['/', '/events', '/marks'] as const

export type ChannelSubPath = (typeof channelSubPaths)[number]

export const isChannelSubPath = (path: string): path is ChannelSubPath =>
  (channelSubPaths as readonly string[]).includes(path)

/** Sends a request to the DockChannel object of `key`; `pathAndQuery` starts with `/`. */
export const fetchChannel = (
  env: ChannelEnv,
  key: string,
  pathAndQuery: string,
  init?: RequestInit
): Promise<Response> => {
  const request = new Request(`${CHANNEL_ORIGIN}${pathAndQuery}`, init)
  request.headers.set(DOCK_KEY_HEADER, key)
  const stub = env.DOCK_CHANNEL.get(env.DOCK_CHANNEL.idFromName(key))
  // Worker and DOM Request/Response types differ only nominally
  return stub.fetch(request as never) as unknown as Promise<Response>
}
