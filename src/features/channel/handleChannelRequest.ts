import type { ChannelEnv } from './channelClient'
import { fetchChannel, isChannelSubPath } from './channelStub'
import { DOCK_KEY_PATTERN } from './protocol'

/** Sub-path after the key segment of `pathname`, e.g. `/api/channel/<key>/marks` → `/marks`. */
export const channelSubPath = (pathname: string, key: string): string => {
  const marker = `/${key}`
  const at = pathname.indexOf(marker)
  const rest = at === -1 ? '' : pathname.slice(at + marker.length)
  const trimmed = rest.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

/**
 * Validates the dock key and forwards the request (WebSocket upgrade, `/events`, `/marks`)
 * to the DockChannel Durable Object named after it.
 */
export const handleChannelRequest = (
  request: Request,
  key: string,
  env: ChannelEnv
): Promise<Response> | Response => {
  // MVP-SHORTCUT(MVP-05): the dock key is the only auth for subscribing, publishing and marks; no rate limit
  if (!DOCK_KEY_PATTERN.test(key)) return new Response('Invalid dock key', { status: 400 })

  const url = new URL(request.url)
  const subPath = channelSubPath(url.pathname, key)
  if (!isChannelSubPath(subPath)) return new Response('Not found', { status: 404 })

  return fetchChannel(env, key, `${subPath}${url.search}`, request)
}
