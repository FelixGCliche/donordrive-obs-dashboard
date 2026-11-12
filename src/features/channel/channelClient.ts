import type { DurableObjectNamespace } from '@cloudflare/workers-types'

export type ChannelEnv = {
  DOCK_CHANNEL: DurableObjectNamespace
}

export type ChannelPath = '/events' | '/marks'

/** Server-side call into the DockChannel Durable Object for `key`. */
export const callChannel = (
  _env: ChannelEnv,
  _key: string,
  _path: ChannelPath,
  _init?: RequestInit
): Promise<Response> => {
  throw new Error('not implemented')
}
