import type { DockSearch } from '@features/dock'
import type { DonorDriveHost } from '@features/donordrive'

const DOCK_SEARCH_ORDER = ['pid', 'host', 'interval', 'theme', 'density', 'channel', 'key'] as const

/** Dock search params the setup page sets; `channel` is the channel ID, `key` the owner key. */
export type DockUrlSearch = DockSearch & { channel?: string; key?: string }

const trimOrigin = (origin: string): string => new URL(origin).origin

// MVP-SHORTCUT(MVP-01): config lives in the dock URL
/**
 * Builds the OBS dock URL, e.g.
 * `https://app/dock?pid=…&host=…&interval=…&theme=…&density=…&channel=<id>&key=<owner key>`.
 */
export const buildDockUrl = (origin: string, search: DockUrlSearch): string => {
  const url = new URL('/dock', trimOrigin(origin))
  for (const name of DOCK_SEARCH_ORDER) {
    const value = search[name]
    if (value !== undefined) url.searchParams.set(name, String(value))
  }
  return url.toString()
}

export type ChannelUrlParticipant = {
  host?: DonorDriveHost
  pid?: string
}

/**
 * Builds the channel WebSocket URL a third-party app connects to:
 * `wss://app/api/channel/<id>?token=<subscribe token>&host=…&pid=…`, or `ws://` for an http
 * origin (see docs/channel-protocol.md). `host` and `pid` are only added when set; the channel
 * ignores them, but apps use them to call `/pending`.
 */
export const buildChannelUrl = (
  origin: string,
  channelId: string,
  subscribeToken: string,
  participant: ChannelUrlParticipant = {}
): string => {
  const url = new URL(`/api/channel/${encodeURIComponent(channelId)}`, trimOrigin(origin))
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:'
  url.searchParams.set('token', subscribeToken)
  if (participant.host) url.searchParams.set('host', participant.host)
  if (participant.pid) url.searchParams.set('pid', participant.pid)
  return url.toString()
}
