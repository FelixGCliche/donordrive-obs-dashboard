import { describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { parseStoredValue, serializeValue } from './useLocalStorage'

const schema = z.object({ paused: z.boolean(), count: z.number() })
const fallback = { paused: false, count: 0 }

describe('parseStoredValue', () => {
  test('returns the fallback when nothing is stored', () => {
    expect(parseStoredValue(null, schema, fallback)).toBe(fallback)
  })

  test('returns the fallback for malformed JSON', () => {
    expect(parseStoredValue('{not json', schema, fallback)).toBe(fallback)
  })

  test('returns the fallback when the schema rejects the value', () => {
    expect(parseStoredValue('{"paused":"yes","count":1}', schema, fallback)).toBe(fallback)
  })

  test('returns the parsed value when it matches the schema', () => {
    expect(parseStoredValue('{"paused":true,"count":3}', schema, fallback)).toEqual({
      paused: true,
      count: 3,
    })
  })
})

describe('serializeValue', () => {
  test('round-trips through parseStoredValue', () => {
    const value = { paused: true, count: 7 }
    expect(parseStoredValue(serializeValue(value), schema, fallback)).toEqual(value)
  })
})
