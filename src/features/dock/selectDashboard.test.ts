import { describe, expect, test } from 'bun:test'

import type { Incentive } from '@features/donordrive'

import { createMockSandbox, createMockSnapshot, MOCK_NOW } from './dockFixtures'
import { incentiveStatus, newestPendingRedemption, selectDashboard } from './selectDashboard'

const snapshot = createMockSnapshot()
const sandbox = createMockSandbox()
const now = MOCK_NOW.getTime()

const incentive = (overrides: Partial<Incentive> = {}): Incentive => ({
  id: 'i',
  description: 'Incentive',
  amount: 10,
  isActive: true,
  isTest: false,
  ...overrides,
})

describe('selectDashboard', () => {
  test('includes the sandbox test sum in the goal', () => {
    const model = selectDashboard({ snapshot, sandbox, now })
    expect(model.goal).toEqual({ raised: 1860, goal: 2500, testSum: 20, pct: 74.4 })
  })

  test('clamps the goal percentage and handles a missing goal', () => {
    const over = selectDashboard({
      snapshot: { ...snapshot, participant: { ...snapshot.participant, sumDonations: 9000 } },
      now,
    })
    expect(over.goal.pct).toBe(100)

    const noGoal = selectDashboard({
      snapshot: { ...snapshot, participant: { ...snapshot.participant, fundraisingGoal: 0 } },
      now,
    })
    expect(noGoal.goal.pct).toBe(0)
  })

  test('merges live and sandbox activity newest first', () => {
    const model = selectDashboard({ snapshot, sandbox, now })
    expect(model.activity.map((item) => item.id)).toEqual([
      'test-1',
      'd-1',
      'd-2',
      'd-3',
      'd-4',
      'd-5',
    ])
    expect(model.activity[0].isTest).toBe(true)
  })

  test('ignores duplicate donation ids', () => {
    const model = selectDashboard({
      snapshot: { ...snapshot, donations: [...snapshot.donations, snapshot.donations[0]] },
      now,
    })
    expect(model.activity).toHaveLength(snapshot.donations.length)
  })

  test('reads unread state from marks lookups', () => {
    const model = selectDashboard({
      snapshot,
      marks: { isRead: (id) => id === 'd-1', isFulfilled: () => false },
      now,
    })
    expect(model.activity.find((item) => item.id === 'd-1')?.isRead).toBe(true)
    expect(model.unreadCount).toBe(4)
  })

  test('reads unread and fulfilled state from channel marks', () => {
    const model = selectDashboard({
      snapshot,
      marks: { version: 3, read: ['d-1', 'd-2'], fulfilled: ['d-1'], baselined: true },
      now,
    })
    expect(model.unreadCount).toBe(3)
    expect(model.activity.find((item) => item.id === 'd-1')?.incentive).toEqual({
      id: 'i-hero',
      description: 'Pick my next hero',
      isFulfilled: true,
    })
  })

  test('treats everything as read and unfulfilled without marks', () => {
    const model = selectDashboard({ snapshot, now })
    expect(model.unreadCount).toBe(0)
    expect(model.pendingCount).toBe(3)
  })

  test('counts claimed and pending redemptions per incentive', () => {
    const model = selectDashboard({
      snapshot,
      sandbox,
      marks: { isRead: () => true, isFulfilled: (id) => id === 'd-3' },
      now,
    })
    const hero = model.incentives.find((item) => item.id === 'i-hero')
    const song = model.incentives.find((item) => item.id === 'i-song')
    expect(hero).toMatchObject({ claimed: 3, pending: 2 })
    expect(song).toMatchObject({ claimed: 1, pending: 1, quantity: 5 })
    expect(model.pendingCount).toBe(3)
  })

  test('derives incentive status from dates, quantity and isActive', () => {
    const model = selectDashboard({ snapshot, now })
    const statuses = Object.fromEntries(model.incentives.map((item) => [item.id, item.status]))
    expect(statuses).toEqual({
      'i-hero': 'active',
      'i-song': 'active',
      'i-shave': 'sold_out',
      'i-late': 'upcoming',
      'i-old': 'ended',
    })
  })

  test('finds the newest pending redemption of an incentive', () => {
    const model = selectDashboard({
      snapshot,
      sandbox,
      marks: { isRead: () => true, isFulfilled: (id) => id === 'test-1' },
      now,
    })
    expect(newestPendingRedemption(model, 'i-hero')?.id).toBe('d-1')
    expect(newestPendingRedemption(model, 'i-shave')).toBeUndefined()
  })
})

describe('incentiveStatus', () => {
  const later = new Date(now + 60_000).toISOString()
  const earlier = new Date(now - 60_000).toISOString()

  test('is upcoming before it starts', () => {
    expect(incentiveStatus(incentive({ startsAt: later }), 0, now)).toBe('upcoming')
  })

  test('is ended after it ends or when inactive', () => {
    expect(incentiveStatus(incentive({ endsAt: earlier }), 0, now)).toBe('ended')
    expect(incentiveStatus(incentive({ isActive: false }), 0, now)).toBe('ended')
  })

  test('is sold out once every unit is claimed', () => {
    expect(incentiveStatus(incentive({ quantity: 2 }), 2, now)).toBe('sold_out')
    expect(incentiveStatus(incentive({ quantity: 2 }), 1, now)).toBe('active')
  })

  test('is active within its window', () => {
    expect(incentiveStatus(incentive({ startsAt: earlier, endsAt: later }), 0, now)).toBe('active')
  })
})
