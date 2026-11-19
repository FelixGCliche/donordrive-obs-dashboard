import { describe, expect, test } from 'bun:test'

import { defaultParseSearch } from '@tanstack/react-router'

import { dockSearchSchema } from './dockSearch'

const validChannel = 'abcdefghijklmnopqrstuv'
const validKey = `own_${'A-b_C'.repeat(8)}abc`

describe('dockSearchSchema', () => {
  test('fills defaults for an empty search', () => {
    expect(dockSearchSchema.parse({})).toEqual({
      pid: undefined,
      host: 'extralife',
      interval: 30,
      theme: 'dark',
      density: 'comfortable',
      channel: undefined,
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
        channel: validChannel,
        key: validKey,
      })
    ).toEqual({
      pid: '12345',
      host: 'try',
      interval: 60,
      theme: 'light',
      density: 'compact',
      channel: validChannel,
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
        channel: 'short',
        key: 'short',
      })
    ).toEqual({
      pid: undefined,
      host: 'extralife',
      interval: 30,
      theme: 'dark',
      density: 'comfortable',
      channel: undefined,
      key: undefined,
    })
  })

  test('rejects a pid longer than 64 characters', () => {
    expect(dockSearchSchema.parse({ pid: 'a'.repeat(65) }).pid).toBeUndefined()
  })

  test('accepts channel IDs and owner keys with dashes and underscores', () => {
    const channel = 'A-b_C'.repeat(4) + 'xy'
    const parsed = dockSearchSchema.parse({ channel, key: validKey })
    expect(parsed.channel).toBe(channel)
    expect(parsed.key).toBe(validKey)
  })

  test('drops an old-format dock key', () => {
    expect(dockSearchSchema.parse({ key: 'abcdefghijklmnopqrstuv' }).key).toBeUndefined()
  })

  test('drops a subscribe token used as the dock key', () => {
    expect(dockSearchSchema.parse({ key: `sub_${'a'.repeat(43)}` }).key).toBeUndefined()
  })

  test('rejects a channel ID of the wrong length', () => {
    expect(dockSearchSchema.parse({ channel: `${validChannel}x` }).channel).toBeUndefined()
  })
})

describe('dockSearchSchema with router-parsed search', () => {
  test('keeps an all-digit pid that the router parsed as a number', () => {
    const parsed = defaultParseSearch('?pid=565094&host=extralife&interval=30')
    expect(dockSearchSchema.parse(parsed).pid).toBe('565094')
  })

  test('still drops a missing pid', () => {
    expect(dockSearchSchema.parse(defaultParseSearch('?host=try')).pid).toBeUndefined()
  })
})
