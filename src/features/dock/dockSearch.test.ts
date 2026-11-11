import { describe, expect, test } from 'bun:test'

import { dockSearchSchema } from './dockSearch'

const validKey = 'abcdefghijklmnopqrstuv'

describe('dockSearchSchema', () => {
  test('fills defaults for an empty search', () => {
    expect(dockSearchSchema.parse({})).toEqual({
      pid: undefined,
      host: 'extralife',
      interval: 30,
      theme: 'dark',
      density: 'comfortable',
      key: undefined,
    })
  })

  test('keeps valid values', () => {
    expect(
      dockSearchSchema.parse({
        pid: '12345',
        host: 'try',
        interval: 60,
        theme: 'light',
        density: 'compact',
        key: validKey,
      })
    ).toEqual({
      pid: '12345',
      host: 'try',
      interval: 60,
      theme: 'light',
      density: 'compact',
      key: validKey,
    })
  })

  test('coerces the interval from a string', () => {
    expect(dockSearchSchema.parse({ interval: '15' }).interval).toBe(15)
  })

  test('falls back on invalid values instead of throwing', () => {
    expect(
      dockSearchSchema.parse({
        pid: 'bad pid!',
        host: 'evil.example.com',
        interval: 5,
        theme: 'neon',
        density: 'huge',
        key: 'short',
      })
    ).toEqual({
      pid: undefined,
      host: 'extralife',
      interval: 30,
      theme: 'dark',
      density: 'comfortable',
      key: undefined,
    })
  })

  test('rejects a pid longer than 64 characters', () => {
    expect(dockSearchSchema.parse({ pid: 'a'.repeat(65) }).pid).toBeUndefined()
  })

  test('accepts keys with dashes and underscores', () => {
    const key = 'A-b_C'.repeat(5)
    expect(dockSearchSchema.parse({ key }).key).toBe(key)
  })
})
