import { describe, expect, test } from 'bun:test'

import { keepNewest, selectReplay } from './eventBuffer'
import type { RelayEvent } from './protocol'
import { eventId } from './protocol'

const makeEvent = (n: number): RelayEvent => ({
  v: 1,
  id: eventId('donation.created', `D${n}`),
  type: 'donation.created',
  ts: '2026-11-07T18:00:00.000Z',
  test: false,
  participantId: '1',
  data: { donationId: `D${n}`, displayName: 'Ana', amount: n },
})

const events = Array.from({ length: 5 }, (_, n) => makeEvent(n))

describe('keepNewest', () => {
  test('keeps the last items', () => {
    expect(keepNewest([1, 2, 3, 4], 2)).toEqual([3, 4])
  })

  test('returns a copy when under the limit', () => {
    const items = [1, 2]
    const kept = keepNewest(items, 5)
    expect(kept).toEqual([1, 2])
    expect(kept).not.toBe(items)
  })
})

describe('selectReplay', () => {
  test('returns every event without since', () => {
    expect(selectReplay(events, undefined)).toEqual(events)
    expect(selectReplay(events, null)).toEqual(events)
  })

  test('returns only events after a known since', () => {
    expect(selectReplay(events, events[2]?.id).map((event) => event.id)).toEqual([
      events[3]?.id,
      events[4]?.id,
    ])
  })

  test('returns nothing when since is the newest event', () => {
    expect(selectReplay(events, events[4]?.id)).toEqual([])
  })

  test('returns the whole window for an unknown since', () => {
    expect(selectReplay(events, 'donation.created:nope')).toEqual(events)
  })

  test('caps the window and treats since outside it as unknown', () => {
    expect(selectReplay(events, undefined, 2)).toEqual(events.slice(3))
    expect(selectReplay(events, events[1]?.id, 2)).toEqual(events.slice(3))
  })
})
