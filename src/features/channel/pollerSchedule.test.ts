import { describe, expect, test } from 'bun:test'

import type { PollerClock } from './pollerSchedule'
import { IDLE_AFTER_MS, POLL_INTERVAL_MS, WIPE_AFTER_MS, planAlarm } from './pollerSchedule'

const now = 1_800_000_000_000

const clock = (extra: Partial<PollerClock> = {}): PollerClock => ({
  now,
  registered: true,
  hasSockets: false,
  lastActiveAt: now,
  lastDonationAt: 0,
  ...extra,
})

describe('planAlarm', () => {
  test('polls with sockets regardless of timestamps', () => {
    expect(planAlarm(clock({ hasSockets: true, lastActiveAt: 0, lastDonationAt: 0 }))).toEqual({
      kind: 'poll',
      nextAt: now + POLL_INTERVAL_MS,
    })
  })

  test('polls within 24h of the last touch', () => {
    expect(planAlarm(clock({ lastActiveAt: now - IDLE_AFTER_MS + 1 }))).toEqual({
      kind: 'poll',
      nextAt: now + POLL_INTERVAL_MS,
    })
    expect(planAlarm(clock({ lastActiveAt: 0, lastDonationAt: now - 1000 })).kind).toBe('poll')
  })

  test('sleeps at and after 24h idle', () => {
    expect(planAlarm(clock({ lastActiveAt: now - IDLE_AFTER_MS })).kind).toBe('sleep')
    expect(planAlarm(clock({ lastActiveAt: now - IDLE_AFTER_MS - 1 })).kind).toBe('sleep')
  })

  test('sleeps when unregistered, even when active', () => {
    expect(planAlarm(clock({ registered: false })).kind).toBe('sleep')
    expect(planAlarm(clock({ registered: false, hasSockets: true })).kind).toBe('sleep')
  })

  test('sleeps until the wipe deadline of the last touch', () => {
    const lastTouch = now - 2 * IDLE_AFTER_MS
    expect(planAlarm(clock({ lastActiveAt: lastTouch - 5, lastDonationAt: lastTouch }))).toEqual({
      kind: 'sleep',
      nextAt: lastTouch + WIPE_AFTER_MS,
    })
    expect(planAlarm(clock({ registered: false, hasSockets: true }))).toEqual({
      kind: 'sleep',
      nextAt: now + WIPE_AFTER_MS,
    })
  })

  test('wipes at exactly 30 days idle', () => {
    expect(planAlarm(clock({ lastActiveAt: now - WIPE_AFTER_MS }))).toEqual({ kind: 'wipe' })
    expect(planAlarm(clock({ lastActiveAt: now - WIPE_AFTER_MS + 1 })).kind).toBe('sleep')
    expect(planAlarm(clock({ registered: false, lastActiveAt: now - WIPE_AFTER_MS })).kind).toBe(
      'wipe'
    )
  })

  test('never wipes with sockets connected', () => {
    expect(
      planAlarm(clock({ registered: false, hasSockets: true, lastActiveAt: 0, lastDonationAt: 0 }))
        .kind
    ).not.toBe('wipe')
  })
})
