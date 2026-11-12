import { describe, expect, test } from 'bun:test'

import type { RelayEvent, ServerFrame } from './protocol'
import {
  DOCK_KEY_PATTERN,
  eventId,
  marksOpSchema,
  marksSchema,
  relayEventSchema,
  serverFrameSchema,
} from './protocol'

const event: RelayEvent = {
  v: 1,
  id: 'incentive.redeemed:D123',
  type: 'incentive.redeemed',
  ts: '2026-11-07T18:00:00.000Z',
  test: false,
  participantId: '12345',
  data: {
    donationId: 'D123',
    displayName: 'Ana',
    amount: 25,
    message: 'Option B, please!',
    incentiveId: 'I9',
    incentiveDescription: 'Choose an option',
  },
}

describe('eventId', () => {
  test('joins type and donation id', () => {
    expect(eventId('donation.created', 'D123')).toBe('donation.created:D123')
  })
})

describe('DOCK_KEY_PATTERN', () => {
  test('accepts 22 to 64 url-safe characters', () => {
    expect(DOCK_KEY_PATTERN.test('a'.repeat(22))).toBe(true)
    expect(DOCK_KEY_PATTERN.test('A-b_'.repeat(16))).toBe(true)
  })

  test('rejects short, long or unsafe keys', () => {
    expect(DOCK_KEY_PATTERN.test('a'.repeat(21))).toBe(false)
    expect(DOCK_KEY_PATTERN.test('a'.repeat(65))).toBe(false)
    expect(DOCK_KEY_PATTERN.test(`${'a'.repeat(22)}/`)).toBe(false)
  })
})

describe('relayEventSchema', () => {
  test('accepts a valid event', () => {
    expect(relayEventSchema.parse(event)).toEqual(event)
  })

  test('accepts a hidden amount', () => {
    const hidden = { ...event, data: { ...event.data, amount: null } }
    expect(relayEventSchema.safeParse(hidden).success).toBe(true)
  })

  test('rejects an id that does not match type and donation id', () => {
    expect(relayEventSchema.safeParse({ ...event, id: 'donation.created:D123' }).success).toBe(
      false
    )
  })

  test('rejects another protocol version', () => {
    expect(relayEventSchema.safeParse({ ...event, v: 2 }).success).toBe(false)
  })

  test('rejects an unknown event type', () => {
    expect(
      relayEventSchema.safeParse({ ...event, type: 'goal.reached', id: 'goal.reached:D123' })
        .success
    ).toBe(false)
  })
})

describe('marksOpSchema', () => {
  test('accepts every op', () => {
    for (const op of ['read', 'unread', 'fulfill', 'unfulfill', 'baseline']) {
      expect(marksOpSchema.safeParse({ op, ids: ['D1'] }).success).toBe(true)
    }
  })

  test('rejects an unknown op or empty ids', () => {
    expect(marksOpSchema.safeParse({ op: 'delete', ids: ['D1'] }).success).toBe(false)
    expect(marksOpSchema.safeParse({ op: 'read', ids: [''] }).success).toBe(false)
  })
})

describe('serverFrameSchema', () => {
  test('parses every frame kind', () => {
    const marks = { version: 3, read: ['D1'], fulfilled: [], baselined: true }
    expect(marksSchema.parse(marks)).toEqual(marks)
    const frames: ServerFrame[] = [
      { kind: 'hello', key: 'a'.repeat(22) },
      { kind: 'replay', events: [event] },
      { kind: 'event', event },
      { kind: 'marks', marks },
    ]
    for (const frame of frames) {
      expect(serverFrameSchema.parse(frame)).toEqual(frame)
    }
  })

  test('rejects an unknown frame kind', () => {
    expect(serverFrameSchema.safeParse({ kind: 'bye' }).success).toBe(false)
  })
})
