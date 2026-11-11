import { describe, expect, test } from 'bun:test'

import type { Marks } from '@features/channel'

import { applyMarksOp, shouldReplaceMarks } from './marksOps'

const marks: Marks = { version: 4, read: ['D1'], fulfilled: ['D2'], baselined: false }

describe('applyMarksOp', () => {
  test('read adds new ids once', () => {
    expect(applyMarksOp(marks, { op: 'read', ids: ['D1', 'D3'] }).read).toEqual(['D1', 'D3'])
  })

  test('unread removes ids', () => {
    expect(applyMarksOp(marks, { op: 'unread', ids: ['D1'] }).read).toEqual([])
  })

  test('fulfill and unfulfill edit the fulfilled list', () => {
    expect(applyMarksOp(marks, { op: 'fulfill', ids: ['D5'] }).fulfilled).toEqual(['D2', 'D5'])
    expect(applyMarksOp(marks, { op: 'unfulfill', ids: ['D2'] }).fulfilled).toEqual([])
  })

  test('returns the same object when nothing changes', () => {
    expect(applyMarksOp(marks, { op: 'read', ids: ['D1'] })).toBe(marks)
    expect(applyMarksOp(marks, { op: 'unfulfill', ids: ['D9'] })).toBe(marks)
  })

  test('baseline marks ids read and sets baselined once', () => {
    const baselined = applyMarksOp(marks, { op: 'baseline', ids: ['D7', 'D8'] })
    expect(baselined).toEqual({ ...marks, read: ['D1', 'D7', 'D8'], baselined: true })
    expect(applyMarksOp(baselined, { op: 'baseline', ids: ['D9'] })).toBe(baselined)
  })

  test('never bumps the version', () => {
    expect(applyMarksOp(marks, { op: 'read', ids: ['D3'] }).version).toBe(4)
  })

  test('does not mutate the input', () => {
    applyMarksOp(marks, { op: 'read', ids: ['D3'] })
    expect(marks.read).toEqual(['D1'])
  })
})

describe('shouldReplaceMarks', () => {
  test('replaces an empty cache', () => {
    expect(shouldReplaceMarks(undefined, marks)).toBe(true)
  })

  test('replaces on a newer or equal version', () => {
    expect(shouldReplaceMarks(marks, { ...marks, version: 5 })).toBe(true)
    expect(shouldReplaceMarks(marks, { ...marks, read: [] })).toBe(true)
  })

  test('ignores an older version', () => {
    expect(shouldReplaceMarks(marks, { ...marks, version: 3 })).toBe(false)
  })
})
