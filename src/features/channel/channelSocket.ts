import type { ChannelAuth } from './channelAuth'
import { CHANNEL_ID_PATTERN, CREDENTIAL_PATTERN } from './channelAuth'
import { CREDENTIAL_ROTATED_CLOSE_CODE } from './channelPaths'
import type { ServerFrame } from './protocol'
import { serverFrameSchema } from './protocol'
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

/** Socket URL of a channel; the credential travels as `?token=` since browsers can't set headers. */
export const channelSocketUrl = (
  auth: ChannelAuth,
  since: string | undefined,
  location: Pick<Location, 'protocol' | 'host'> = globalThis.location
): string => {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
  const query = new URLSearchParams({ token: auth.credential })
  if (since) query.set('since', since)
  return `${protocol}://${location.host}/api/channel/${encodeURIComponent(auth.channelId)}?${query}`
}

/** Identity of a connection: a channel and the credential it is opened with. */
export const connectionKey = (auth: ChannelAuth): string => `${auth.channelId}:${auth.credential}`

/** Whether the server could accept these; malformed ones would never succeed, so are not retried. */
export const isValidChannelAuth = (auth: ChannelAuth): boolean =>
  CHANNEL_ID_PATTERN.test(auth.channelId) && CREDENTIAL_PATTERN.test(auth.credential)

/** A close that means the credential no longer works; reconnecting would never succeed. */
export const isUnauthorizedClose = (code: number): boolean => code === CREDENTIAL_ROTATED_CLOSE_CODE

type Connection = {
  key: string
  auth: ChannelAuth
  status: ChannelStatus
  refs: number
  attempt: number
  lastEventId?: string
  socket?: WebSocket
  timer?: ReturnType<typeof setTimeout>
  frameListeners: Set<ChannelFrameListener>
  statusListeners: Set<() => void>
}

// One connection per channel and credential, shared by every useChannel caller in the page
const connections = new Map<string, Connection>()

const getConnection = (auth: ChannelAuth): Connection => {
  const key = connectionKey(auth)
  let connection = connections.get(key)
  if (!connection) {
    connection = {
      key,
      auth: { channelId: auth.channelId, credential: auth.credential },
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

  const socket = new WebSocket(channelSocketUrl(connection.auth, connection.lastEventId))
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

  socket.addEventListener('close', (event) => {
    if (connection.socket !== socket) return
    connection.socket = undefined
    // Browsers hide an HTTP 401 upgrade failure (it closes with 1006); only the rotation close code is
    // detectable here. A 401 still surfaces through the marks request, which fails with 401 too.
    if (isUnauthorizedClose(event.code)) {
      setStatus(connection, 'unauthorized')
      return
    }
    if (connection.refs > 0) scheduleReconnect(connection)
  })
}

/** Starts (or joins) the connection for `auth`; returns the release function. */
export const acquireChannel = (auth: ChannelAuth): (() => void) => {
  const connection = getConnection(auth)
  // The server rejects malformed channel IDs and credentials; retrying would never succeed
  if (!isValidChannelAuth(auth)) {
    setStatus(connection, 'unauthorized')
    return () => dropIfUnused(connection)
  }

  connection.refs += 1
  if (
    connection.refs === 1 &&
    connection.status !== 'unauthorized' &&
    !connection.socket &&
    !connection.timer
  ) {
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
    // A rejected credential stays rejected while anything still watches this connection
    if (connection.status !== 'unauthorized') setStatus(connection, 'closed')
    dropIfUnused(connection)
  }
}

export const readChannelStatus = (auth: ChannelAuth): ChannelStatus =>
  connections.get(connectionKey(auth))?.status ?? 'connecting'

export const watchChannelStatus = (auth: ChannelAuth, listener: () => void): (() => void) => {
  const connection = getConnection(auth)
  connection.statusListeners.add(listener)
  return () => {
    connection.statusListeners.delete(listener)
    dropIfUnused(connection)
  }
}

export const subscribeChannel = (
  auth: ChannelAuth,
  listener: ChannelFrameListener
): (() => void) => {
  const connection = getConnection(auth)
  connection.frameListeners.add(listener)
  return () => {
    connection.frameListeners.delete(listener)
    dropIfUnused(connection)
  }
}
