import type { ServerFrame } from './protocol'
import { DOCK_KEY_PATTERN, serverFrameSchema } from './protocol'
import type { ChannelFrameListener, ChannelStatus } from './useChannel'

const BACKOFF_BASE_MS = 1000
const BACKOFF_CAP_MS = 30_000

/** Reconnect delay for the nth failed attempt (0-based): exponential, capped, with equal jitter. */
export const backoffDelay = (attempt: number, random: number = Math.random()): number => {
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt))
  return Math.round(ceiling / 2 + (random * ceiling) / 2)
}

/** Parses and validates a socket message; undefined when it is not a known frame. */
export const parseFrame = (data: unknown): ServerFrame | undefined => {
  if (typeof data !== 'string') return undefined
  try {
    const parsed = serverFrameSchema.safeParse(JSON.parse(data))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

/** Id of the newest event a frame carries, used to resume with `since`. */
export const lastEventIdOf = (frame: ServerFrame): string | undefined => {
  if (frame.kind === 'event') return frame.event.id
  if (frame.kind === 'replay') return frame.events.at(-1)?.id
  return undefined
}

export const channelSocketUrl = (key: string, since: string | undefined): string => {
  const protocol = globalThis.location.protocol === 'https:' ? 'wss' : 'ws'
  const query = since ? `?since=${encodeURIComponent(since)}` : ''
  return `${protocol}://${globalThis.location.host}/api/channel/${encodeURIComponent(key)}${query}`
}

type Connection = {
  key: string
  status: ChannelStatus
  refs: number
  attempt: number
  lastEventId?: string
  socket?: WebSocket
  timer?: ReturnType<typeof setTimeout>
  frameListeners: Set<ChannelFrameListener>
  statusListeners: Set<() => void>
}

// One connection per dock key, shared by every useChannel caller in the page
const connections = new Map<string, Connection>()

const getConnection = (key: string): Connection => {
  let connection = connections.get(key)
  if (!connection) {
    connection = {
      key,
      status: 'connecting',
      refs: 0,
      attempt: 0,
      frameListeners: new Set(),
      statusListeners: new Set(),
    }
    connections.set(key, connection)
  }
  return connection
}

const dropIfUnused = (connection: Connection): void => {
  if (
    connection.refs === 0 &&
    connection.frameListeners.size === 0 &&
    connection.statusListeners.size === 0
  ) {
    connections.delete(connection.key)
  }
}

const setStatus = (connection: Connection, status: ChannelStatus): void => {
  if (connection.status === status) return
  connection.status = status
  for (const listener of connection.statusListeners) listener()
}

const emit = (connection: Connection, frame: ServerFrame): void => {
  for (const listener of connection.frameListeners) {
    try {
      listener(frame)
    } catch (error) {
      console.error('[channel] frame listener failed', error)
    }
  }
}

const scheduleReconnect = (connection: Connection): void => {
  setStatus(connection, 'reconnecting')
  const delay = backoffDelay(connection.attempt)
  connection.attempt += 1
  connection.timer = setTimeout(() => open(connection), delay)
}

const open = (connection: Connection): void => {
  connection.timer = undefined
  if (connection.refs === 0) return

  const socket = new WebSocket(channelSocketUrl(connection.key, connection.lastEventId))
  connection.socket = socket

  socket.addEventListener('open', () => {
    if (connection.socket !== socket) return
    connection.attempt = 0
    setStatus(connection, 'open')
  })

  socket.addEventListener('message', (message) => {
    if (connection.socket !== socket) return
    const frame = parseFrame(message.data)
    if (!frame) return
    connection.lastEventId = lastEventIdOf(frame) ?? connection.lastEventId
    emit(connection, frame)
  })

  socket.addEventListener('close', () => {
    if (connection.socket !== socket) return
    connection.socket = undefined
    if (connection.refs > 0) scheduleReconnect(connection)
  })
}

/** Starts (or joins) the connection for `key`; returns the release function. */
export const acquireChannel = (key: string): (() => void) => {
  const connection = getConnection(key)
  // The server rejects malformed keys; retrying would never succeed
  if (!DOCK_KEY_PATTERN.test(key)) {
    setStatus(connection, 'closed')
    return () => dropIfUnused(connection)
  }

  connection.refs += 1
  if (connection.refs === 1 && !connection.socket && !connection.timer) {
    setStatus(connection, connection.status === 'closed' ? 'connecting' : connection.status)
    open(connection)
  }

  let released = false
  return () => {
    if (released) return
    released = true
    connection.refs -= 1
    if (connection.refs > 0) return

    clearTimeout(connection.timer)
    connection.timer = undefined
    const socket = connection.socket
    connection.socket = undefined
    socket?.close(1000, 'released')
    connection.attempt = 0
    setStatus(connection, 'closed')
    dropIfUnused(connection)
  }
}

export const readChannelStatus = (key: string): ChannelStatus =>
  connections.get(key)?.status ?? 'connecting'

export const watchChannelStatus = (key: string, listener: () => void): (() => void) => {
  const connection = getConnection(key)
  connection.statusListeners.add(listener)
  return () => {
    connection.statusListeners.delete(listener)
    dropIfUnused(connection)
  }
}

export const subscribeChannel = (key: string, listener: ChannelFrameListener): (() => void) => {
  const connection = getConnection(key)
  connection.frameListeners.add(listener)
  return () => {
    connection.frameListeners.delete(listener)
    dropIfUnused(connection)
  }
}
