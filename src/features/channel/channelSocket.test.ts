import { describe, expect, test } from 'bun:test'

import { backoffDelay, lastEventIdOf, parseFrame } from './channelSocket'
import type { RelayEvent } from './protocol'

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
    expect(lastEventIdOf({ kind: 'hello', key: 'k' })).toBeUndefined()
  })
})
