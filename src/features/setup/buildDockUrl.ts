import type { DockSearch } from '@features/dock'
import type { DonorDriveHost } from '@features/donordrive'

const DOCK_SEARCH_ORDER = ['pid', 'host', 'interval', 'theme', 'density', 'key'] as const

const trimOrigin = (origin: string): string => new URL(origin).origin

// MVP-SHORTCUT(MVP-01): config lives in the dock URL
/** Builds the OBS dock URL, e.g. `https://app/dock?pid=…&host=…&interval=…&theme=…&density=…&key=…`. */
export const buildDockUrl = (origin: string, search: DockSearch): string => {
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
 * `wss://app/api/channel/<key>?host=…&pid=…`, or `ws://` for an http origin
 * (see docs/channel-protocol.md). `host` and `pid` are only added when set; the channel ignores
 * them, but apps use them to call `/pending`.
 */
export const buildChannelUrl = (
  origin: string,
  key: string,
  participant: ChannelUrlParticipant = {}
): string => {
  const url = new URL(`/api/channel/${encodeURIComponent(key)}`, trimOrigin(origin))
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:'
  if (participant.host) url.searchParams.set('host', participant.host)
  if (participant.pid) url.searchParams.set('pid', participant.pid)
  return url.toString()
}
