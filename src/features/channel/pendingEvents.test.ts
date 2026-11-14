import { describe, expect, test } from 'bun:test'

import type { Donation, Incentive } from '@features/donordrive'

import { activityItemEvents } from './activityEvents'
import { pendingRedemptionEvents } from './pendingEvents'

const donation = (id: string, minute: number, extra: Partial<Donation> = {}): Donation => ({
  id,
  displayName: 'Ana',
  amount: 25,
  createdAt: `2026-11-07T18:${String(minute).padStart(2, '0')}:00.000Z`,
  isTest: false,
  ...extra,
})

const incentive = (id: string, description: string): Incentive => ({
  id,
  description,
  amount: 10,
  isActive: true,
  isTest: false,
})

const incentives = [incentive('I1', 'Pick a hero'), incentive('I2', 'Un-complete')]

// Newest first, as DonorDrive returns them
const donations = [
  donation('D5', 5, { incentiveId: 'I2', message: 'again' }),
  donation('D4', 4, { incentiveId: 'I1' }),
  donation('D3', 3),
  donation('D2', 2, { incentiveId: 'I1', message: 'Mercy' }),
  donation('D1', 1, { incentiveId: 'I9' }),
]

const ids = (events: { id: string }[]) => events.map((event) => event.id)

describe('pendingRedemptionEvents', () => {
  test('returns redemptions oldest first, skipping plain donations and unknown incentives', () => {
    const events = pendingRedemptionEvents({
      donations,
      incentives,
      fulfilled: [],
      participantId: 'P1',
    })
    expect(ids(events)).toEqual([
      'incentive.redeemed:D2',
      'incentive.redeemed:D4',
      'incentive.redeemed:D5',
    ])
  })

  test('skips fulfilled donations', () => {
    const events = pendingRedemptionEvents({
      donations,
      incentives,
      fulfilled: ['D2', 'D5'],
      participantId: 'P1',
    })
    expect(ids(events)).toEqual(['incentive.redeemed:D4'])
  })

  test('filters by incentive ids when given', () => {
    const events = pendingRedemptionEvents({
      donations,
      incentives,
      fulfilled: [],
      participantId: 'P1',
      incentiveIds: ['I2'],
    })
    expect(ids(events)).toEqual(['incentive.redeemed:D5'])
  })

  test('builds the same event as the dock publishes', () => {
    const [event] = pendingRedemptionEvents({
      donations: [donations[3] as Donation],
      incentives,
      fulfilled: [],
      participantId: 'P1',
    })
    const published = activityItemEvents(
      {
        ...(donations[3] as Donation),
        isRead: false,
        incentive: { id: 'I1', description: 'Pick a hero', isFulfilled: false },
      },
      'P1'
    ).find((candidate) => candidate.type === 'incentive.redeemed')
    expect(published).toBeDefined()
    expect(event).toEqual(published as NonNullable<typeof published>)
    expect(event).toEqual({
      v: 1,
      id: 'incentive.redeemed:D2',
      type: 'incentive.redeemed',
      ts: '2026-11-07T18:02:00.000Z',
      test: false,
      participantId: 'P1',
      data: {
        donationId: 'D2',
        displayName: 'Ana',
        amount: 25,
        message: 'Mercy',
        incentiveId: 'I1',
        incentiveDescription: 'Pick a hero',
      },
    })
  })

  test('keeps API order for donations at the same time, reversed', () => {
    const events = pendingRedemptionEvents({
      donations: [donation('B', 1, { incentiveId: 'I1' }), donation('A', 1, { incentiveId: 'I1' })],
      incentives,
      fulfilled: [],
      participantId: 'P1',
    })
    expect(ids(events)).toEqual(['incentive.redeemed:A', 'incentive.redeemed:B'])
  })
})
