import { describe, expect, test } from 'bun:test'

import { formatAgo, formatMoney, formatShortAge, initials } from './dockFormat'

const now = Date.parse('2026-11-07T20:00:00.000Z')
const ago = (ms: number) => new Date(now - ms).toISOString()

describe('formatMoney', () => {
  test('drops decimals for whole amounts', () => {
    expect(formatMoney(50)).toBe('$50')
    expect(formatMoney(2500)).toBe('$2,500')
  })

  test('keeps two decimals otherwise', () => {
    expect(formatMoney(12.5)).toBe('$12.50')
  })
})

describe('formatShortAge', () => {
  test('formats compact ages', () => {
    expect(formatShortAge(ago(10_000), now)).toBe('now')
    expect(formatShortAge(ago(2 * 60_000), now)).toBe('2m')
    expect(formatShortAge(ago(3 * 3_600_000), now)).toBe('3h')
    expect(formatShortAge(ago(50 * 3_600_000), now)).toBe('2d')
  })
})

describe('formatAgo', () => {
  test('formats ages with a unit', () => {
    expect(formatAgo(ago(12_000), now)).toBe('12s ago')
    expect(formatAgo(ago(5 * 60_000), now)).toBe('5m ago')
  })
})

describe('initials', () => {
  test('takes up to two initials', () => {
    expect(initials('Marie-Ève Tremblay')).toBe('MT')
    expect(initials('sam')).toBe('S')
    expect(initials('  ')).toBe('?')
  })
})
