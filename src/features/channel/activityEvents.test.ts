import { describe, expect, test } from 'bun:test'

import type { ActivityItem, DashboardModel } from '@features/dock'

import { activityItemEvents, newActivityEvents } from './activityEvents'

const item = (id: string, extra: Partial<ActivityItem> = {}): ActivityItem => ({
  id,
  displayName: 'Ana',
  amount: 25,
  createdAt: '2026-11-07T18:00:00.000Z',
  isRead: false,
  isTest: false,
  ...extra,
})

const model = (activity: ActivityItem[]): DashboardModel => ({
  participant: {
    id: 'P1',
    displayName: 'Streamer',
    sumDonations: 0,
    fundraisingGoal: 0,
    numDonations: 0,
  },
  goal: { raised: 0, goal: 0, testSum: 0, pct: 0 },
  activity,
  unreadCount: 0,
  incentives: [],
  pendingCount: 0,
  fetchedAt: '2026-11-07T18:00:00.000Z',
})

describe('activityItemEvents', () => {
  test('emits donation.created for a plain donation', () => {
    const events = activityItemEvents(item('D1', { message: 'hi' }), 'P1')
    expect(events).toEqual([
      {
        v: 1,
        id: 'donation.created:D1',
        type: 'donation.created',
        ts: '2026-11-07T18:00:00.000Z',
        test: false,
        participantId: 'P1',
        data: { donationId: 'D1', displayName: 'Ana', amount: 25, message: 'hi' },
      },
    ])
  })

  test('adds incentive.redeemed when the donation has an incentive', () => {
    const events = activityItemEvents(
      item('D2', {
        isTest: true,
        message: 'option b',
        incentive: { id: 'I1', description: 'Choose an option', isFulfilled: false },
      }),
      'P1'
    )
    expect(events.map((event) => event.id)).toEqual([
      'donation.created:D2',
      'incentive.redeemed:D2',
    ])
    expect(events[1]?.test).toBe(true)
    expect(events[1]?.data).toEqual({
      donationId: 'D2',
      displayName: 'Ana',
      amount: 25,
      message: 'option b',
      incentiveId: 'I1',
      incentiveDescription: 'Choose an option',
    })
  })

  test('drops events the channel would reject', () => {
    expect(activityItemEvents(item('x'.repeat(200)), 'P1')).toEqual([])
  })
})

describe('newActivityEvents', () => {
  test('returns only unseen items, oldest first', () => {
    const result = newActivityEvents(model([item('D3'), item('D2'), item('D1')]), new Set(['D1']))
    expect(result.newIds).toEqual(['D2', 'D3'])
    expect(result.events.map((event) => event.id)).toEqual([
      'donation.created:D2',
      'donation.created:D3',
    ])
  })

  test('returns nothing when everything was seen', () => {
    expect(newActivityEvents(model([item('D1')]), new Set(['D1']))).toEqual({
      newIds: [],
      events: [],
    })
  })
})
