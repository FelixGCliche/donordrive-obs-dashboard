import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { ChannelAuth } from './channelAuth'
import { CREDENTIAL_ROTATED_CLOSE_CODE } from './channelPaths'
import {
  acquireChannel,
  backoffDelay,
  channelSocketUrl,
  connectionKey,
  isUnauthorizedClose,
  isValidChannelAuth,
  lastEventIdOf,
  parseFrame,
  readChannelStatus,
  watchChannelStatus,
} from './channelSocket'
import type { RelayEvent } from './protocol'

const auth: ChannelAuth = {
  channelId: 'abcdefghijklmnopqrstuv',
  credential: `own_${'a'.repeat(43)}`,
}

const event: RelayEvent = {
  v: 1,
  id: 'donation.created:D1',
  type: 'donation.created',
  ts: '2026-11-07T18:00:00.000Z',
  test: false,
  participantId: '1',
  data: { donationId: 'D1', displayName: 'Ana', amount: 5 },
}

describe('backoffDelay', () => {
  test('grows exponentially between half and the full ceiling', () => {
    expect(backoffDelay(0, 0)).toBe(500)
    expect(backoffDelay(0, 1)).toBe(1000)
    expect(backoffDelay(3, 0)).toBe(4000)
    expect(backoffDelay(3, 1)).toBe(8000)
  })

  test('caps at 30 seconds', () => {
    expect(backoffDelay(20, 1)).toBe(30_000)
    expect(backoffDelay(20, 0)).toBe(15_000)
  })
})

describe('parseFrame', () => {
  test('parses a valid frame', () => {
    expect(parseFrame(JSON.stringify({ kind: 'event', event }))).toEqual({ kind: 'event', event })
  })

  test('parses a hello frame with its role', () => {
    expect(parseFrame(JSON.stringify({ kind: 'hello', role: 'subscriber' }))).toEqual({
      kind: 'hello',
      role: 'subscriber',
    })
  })

  test('drops an old hello frame that echoes the key', () => {
    expect(parseFrame(JSON.stringify({ kind: 'hello', key: 'k' }))).toBeUndefined()
  })

  test('drops invalid json, unknown frames and binary data', () => {
    expect(parseFrame('{')).toBeUndefined()
    expect(parseFrame(JSON.stringify({ kind: 'bye' }))).toBeUndefined()
    expect(parseFrame(new ArrayBuffer(2))).toBeUndefined()
  })
})

describe('lastEventIdOf', () => {
  test('reads event and replay frames', () => {
    expect(lastEventIdOf({ kind: 'event', event })).toBe(event.id)
    expect(lastEventIdOf({ kind: 'replay', events: [event] })).toBe(event.id)
    expect(lastEventIdOf({ kind: 'replay', events: [] })).toBeUndefined()
    expect(lastEventIdOf({ kind: 'hello', role: 'owner' })).toBeUndefined()
  })
})

describe('channelSocketUrl', () => {
  test('puts the channel ID in the path and the credential in the token query', () => {
    expect(channelSocketUrl(auth, undefined, { protocol: 'https:', host: 'dock.example' })).toBe(
      `wss://dock.example/api/channel/${auth.channelId}?token=${auth.credential}`
    )
  })

  test('adds since and uses ws on http', () => {
    expect(
      channelSocketUrl(auth, 'donation.created:D1', { protocol: 'http:', host: 'localhost:3000' })
    ).toBe(
      `ws://localhost:3000/api/channel/${auth.channelId}?token=${auth.credential}&since=donation.created%3AD1`
    )
  })
})

describe('connectionKey and isValidChannelAuth', () => {
  test('keys connections by channel and credential', () => {
    expect(connectionKey(auth)).toBe(`${auth.channelId}:${auth.credential}`)
    expect(connectionKey({ ...auth, credential: `sub_${'a'.repeat(43)}` })).not.toBe(
      connectionKey(auth)
    )
  })

  test('accepts owner keys and subscribe tokens only with a valid channel ID', () => {
    expect(isValidChannelAuth(auth)).toBe(true)
    expect(isValidChannelAuth({ ...auth, credential: `sub_${'a'.repeat(43)}` })).toBe(true)
    expect(isValidChannelAuth({ ...auth, credential: 'abcdefghijklmnopqrstuv' })).toBe(false)
    expect(isValidChannelAuth({ ...auth, channelId: 'short' })).toBe(false)
  })
})

describe('isUnauthorizedClose', () => {
  test('only the credential-rotated code means unauthorized', () => {
    expect(isUnauthorizedClose(CREDENTIAL_ROTATED_CLOSE_CODE)).toBe(true)
    expect(isUnauthorizedClose(1006)).toBe(false)
    expect(isUnauthorizedClose(1000)).toBe(false)
  })
})

type Listener = (event: { code?: number; data?: unknown }) => void

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  readonly url: string
  closedWith: number | undefined
  private listeners = new Map<string, Listener[]>()

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  close(code: number) {
    this.closedWith = code
  }

  fire(type: string, event: { code?: number; data?: unknown } = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

describe('acquireChannel', () => {
  const originalWebSocket = globalThis.WebSocket
  const originalLocation = globalThis.location

  beforeEach(() => {
    FakeWebSocket.instances = []
    Object.assign(globalThis, {
      WebSocket: FakeWebSocket,
      location: { protocol: 'https:', host: 'dock.example' },
    })
  })

  afterEach(() => {
    Object.assign(globalThis, { WebSocket: originalWebSocket, location: originalLocation })
  })

  test('opens the socket with the token and goes open', () => {
    const release = acquireChannel(auth)
    const [socket] = FakeWebSocket.instances
    expect(socket.url).toContain(`token=${auth.credential}`)
    socket.fire('open')
    expect(readChannelStatus(auth)).toBe('open')
    release()
    expect(socket.closedWith).toBe(1000)
  })

  test('goes unauthorized and stops reconnecting on a credential-rotated close', () => {
    const stopWatching = watchChannelStatus(auth, () => {})
    const release = acquireChannel(auth)
    const [socket] = FakeWebSocket.instances
    socket.fire('open')
    socket.fire('close', { code: CREDENTIAL_ROTATED_CLOSE_CODE })
    expect(readChannelStatus(auth)).toBe('unauthorized')
    release()
    // Still unauthorized for anything watching, and no new socket was opened
    expect(readChannelStatus(auth)).toBe('unauthorized')
    expect(FakeWebSocket.instances).toHaveLength(1)
    stopWatching()
  })

  test('reconnects after any other close', () => {
    const release = acquireChannel(auth)
    const [socket] = FakeWebSocket.instances
    socket.fire('open')
    socket.fire('close', { code: 1006 })
    expect(readChannelStatus(auth)).toBe('reconnecting')
    release()
  })

  test('never opens a socket for a malformed credential', () => {
    const badAuth = { ...auth, credential: 'abcdefghijklmnopqrstuv' }
    const stopWatching = watchChannelStatus(badAuth, () => {})
    const release = acquireChannel(badAuth)
    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(readChannelStatus(badAuth)).toBe('unauthorized')
    release()
    stopWatching()
  })
})
