import { describe, expect, test } from 'bun:test'

import type { Donation, Incentive, Snapshot } from '@features/donordrive'

import { INCENTIVE_GRACE_MS, diffSnapshot, snapshotEventItems } from './snapshotEvents'

const now = Date.parse('2026-11-07T18:00:00.000Z')
const ago = (ms: number) => new Date(now - ms).toISOString()

const donation = (id: string, createdAt: string, extra: Partial<Donation> = {}): Donation => ({
  id,
  displayName: 'Ana',
  amount: 10,
  createdAt,
  isTest: false,
  ...extra,
})

const incentive = (id: string, description = 'Hydrate'): Incentive => ({
  id,
  description,
  amount: 5,
  isActive: true,
  isTest: false,
})

const snapshot = (donations: Donation[], incentives: Incentive[] = []): Snapshot => ({
  participant: {
    id: 'P1',
    displayName: 'Streamer',
    sumDonations: 0,
    fundraisingGoal: 0,
    numDonations: donations.length,
  },
  donations,
  incentives,
  fetchedAt: new Date(now).toISOString(),
})

const OLD = INCENTIVE_GRACE_MS + 1000

describe('snapshotEventItems', () => {
  test('sorts newest first, resolves incentives and drops test donations', () => {
    const items = snapshotEventItems(
      snapshot(
        [
          donation('D1', ago(3000)),
          donation('D3', ago(1000), { incentiveId: 'I1', message: 'hi' }),
          donation('T1', ago(500), { isTest: true }),
          donation('D2', ago(2000)),
        ],
        [incentive('I1', 'Sing a song')]
      )
    )
    expect(items.map((item) => item.id)).toEqual(['D3', 'D2', 'D1'])
    expect(items[0]).toEqual({
      id: 'D3',
      displayName: 'Ana',
      amount: 10,
      message: 'hi',
      createdAt: ago(1000),
      isTest: false,
      incentive: { id: 'I1', description: 'Sing a song' },
    })
  })
})

describe('diffSnapshot', () => {
  test('baseline marks everything seen without events', () => {
    const result = diffSnapshot(
      snapshot([donation('D2', ago(1000), { incentiveId: 'missing' }), donation('D1', ago(OLD))]),
      new Set(),
      true,
      now
    )
    expect(result).toEqual({ seenIds: ['D2', 'D1'], events: [] })
  })

  test('publishes unseen donations oldest first', () => {
    const result = diffSnapshot(
      snapshot([donation('D3', ago(1000)), donation('D2', ago(2000)), donation('D1', ago(3000))]),
      new Set(['D1']),
      false,
      now
    )
    expect(result.seenIds).toEqual(['D2', 'D3'])
    expect(result.events.map((event) => event.id)).toEqual([
      'donation.created:D2',
      'donation.created:D3',
    ])
    expect(result.events.every((event) => event.participantId === 'P1')).toBe(true)
  })

  test('emits both events for a donation with a known incentive', () => {
    const result = diffSnapshot(
      snapshot([donation('D1', ago(1000), { incentiveId: 'I1' })], [incentive('I1', 'Hydrate')]),
      new Set(),
      false,
      now
    )
    expect(result.seenIds).toEqual(['D1'])
    expect(result.events.map((event) => event.id)).toEqual([
      'donation.created:D1',
      'incentive.redeemed:D1',
    ])
    expect(result.events[1]?.data).toMatchObject({
      incentiveId: 'I1',
      incentiveDescription: 'Hydrate',
    })
  })

  test('publishes only donation.created for an unknown incentive past the grace period', () => {
    const result = diffSnapshot(
      snapshot([donation('D1', ago(OLD), { incentiveId: 'missing' })]),
      new Set(),
      false,
      now
    )
    expect(result.seenIds).toEqual(['D1'])
    expect(result.events.map((event) => event.id)).toEqual(['donation.created:D1'])
  })

  test('defers a recent donation whose incentive is not listed yet', () => {
    const result = diffSnapshot(
      snapshot([
        donation('D2', ago(INCENTIVE_GRACE_MS - 1), { incentiveId: 'missing' }),
        donation('D1', ago(OLD)),
      ]),
      new Set(),
      false,
      now
    )
    expect(result.seenIds).toEqual(['D1'])
    expect(result.events.map((event) => event.id)).toEqual(['donation.created:D1'])
  })

  test('skips donations already seen', () => {
    expect(
      diffSnapshot(snapshot([donation('D1', ago(1000))]), new Set(['D1']), false, now)
    ).toEqual({ seenIds: [], events: [] })
  })

  test('drops test donations', () => {
    expect(
      diffSnapshot(snapshot([donation('T1', ago(1000), { isTest: true })]), new Set(), false, now)
    ).toEqual({ seenIds: [], events: [] })
  })

  test('marks donations seen even when their events are invalid', () => {
    const id = 'x'.repeat(200)
    expect(diffSnapshot(snapshot([donation(id, ago(1000))]), new Set(), false, now)).toEqual({
      seenIds: [id],
      events: [],
    })
  })
})
