import { describe, expect, test } from 'bun:test'

import {
  isMarksUnauthorizedError,
  MARKS_FORBIDDEN_MESSAGE,
  MARKS_RATE_LIMITED_MESSAGE,
  MARKS_UNAUTHORIZED_MESSAGE,
  marksErrorMessage,
} from './marksErrors'

describe('marksErrorMessage', () => {
  test('maps auth and rate-limit statuses to messages', () => {
    expect(marksErrorMessage(401)).toBe(MARKS_UNAUTHORIZED_MESSAGE)
    expect(marksErrorMessage(403)).toBe(MARKS_FORBIDDEN_MESSAGE)
    expect(marksErrorMessage(429)).toBe(MARKS_RATE_LIMITED_MESSAGE)
  })

  test('falls back to the status for anything else', () => {
    expect(marksErrorMessage(500)).toBe('Marks request failed (500)')
  })
})

describe('isMarksUnauthorizedError', () => {
  test('recognizes only the unauthorized message', () => {
    expect(isMarksUnauthorizedError(new Error(MARKS_UNAUTHORIZED_MESSAGE))).toBe(true)
    expect(isMarksUnauthorizedError(new Error(MARKS_FORBIDDEN_MESSAGE))).toBe(false)
    expect(isMarksUnauthorizedError(MARKS_UNAUTHORIZED_MESSAGE)).toBe(false)
    expect(isMarksUnauthorizedError(undefined)).toBe(false)
  })
})
