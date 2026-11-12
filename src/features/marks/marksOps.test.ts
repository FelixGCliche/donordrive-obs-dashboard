import { describe, expect, test } from 'bun:test'

import type { Marks } from '@features/channel'

import { applyMarksOp, baselineOp, MAX_OP_IDS, shouldReplaceMarks } from './marksOps'

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

describe('baselineOp', () => {
  test('baselines the shown donations when the key is new', () => {
    expect(baselineOp(marks, ['D1', 'D2'])).toEqual({ op: 'baseline', ids: ['D1', 'D2'] })
  })

  test('skips an already baselined key or an empty feed', () => {
    expect(baselineOp({ ...marks, baselined: true }, ['D1'])).toBeUndefined()
    expect(baselineOp(marks, [])).toBeUndefined()
  })

  test('caps the ids to the protocol limit', () => {
    const ids = Array.from({ length: MAX_OP_IDS + 5 }, (_, i) => `D${i}`)
    expect(baselineOp(marks, ids)?.ids).toHaveLength(MAX_OP_IDS)
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
