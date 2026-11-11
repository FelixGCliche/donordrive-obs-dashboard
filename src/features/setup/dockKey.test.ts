import { describe, expect, test } from 'bun:test'

import { DOCK_KEY_PATTERN } from '@features/channel'

import { ensureDockKey, generateDockKey, isDockKey } from './dockKey'

describe('generateDockKey', () => {
  test('returns 22 base64url characters matching the dock key pattern', () => {
    for (let i = 0; i < 200; i++) {
      const key = generateDockKey()
      expect(key).toHaveLength(22)
      expect(key).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(DOCK_KEY_PATTERN.test(key)).toBe(true)
    }
  })

  test('returns a different key each time', () => {
    const keys = new Set(Array.from({ length: 500 }, generateDockKey))
    expect(keys.size).toBe(500)
  })
})

describe('ensureDockKey', () => {
  test('keeps a valid stored key', () => {
    const key = generateDockKey()
    expect(ensureDockKey(key)).toBe(key)
  })

  test('generates a key when none is stored', () => {
    expect(isDockKey(ensureDockKey(null))).toBe(true)
  })

  test('replaces an invalid stored key', () => {
    const key = ensureDockKey('too-short')
    expect(key).not.toBe('too-short')
    expect(isDockKey(key)).toBe(true)
  })
})
