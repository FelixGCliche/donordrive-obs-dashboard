import type { DockSearch } from '@features/dock'

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

/**
 * Builds the channel WebSocket URL a third-party app connects to:
 * `wss://app/api/channel/<key>`, or `ws://` for an http origin (see docs/channel-protocol.md).
 */
export const buildChannelUrl = (origin: string, key: string): string => {
  const url = new URL(`/api/channel/${encodeURIComponent(key)}`, trimOrigin(origin))
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:'
  return url.toString()
}
