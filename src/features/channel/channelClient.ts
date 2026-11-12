import type { DurableObjectNamespace } from '@cloudflare/workers-types'

import { fetchChannel } from './channelStub'
import { DOCK_KEY_PATTERN } from './protocol'

export type ChannelEnv = {
  DOCK_CHANNEL: DurableObjectNamespace
}

export type ChannelPath = '/events' | '/marks'

/** Server-side call into the DockChannel Durable Object for `key`. */
export const callChannel = async (
  env: ChannelEnv,
  key: string,
  path: ChannelPath,
  init?: RequestInit
): Promise<Response> => {
  if (!DOCK_KEY_PATTERN.test(key)) return new Response('Invalid dock key', { status: 400 })
  return fetchChannel(env, key, path, init)
}
