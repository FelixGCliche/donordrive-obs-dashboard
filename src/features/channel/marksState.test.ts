import { describe, expect, test } from 'bun:test'

import type { MarksState } from './marksState'
import { applyMarksOp } from './marksState'

const empty: MarksState = { read: [], fulfilled: [], baselined: false }

describe('applyMarksOp', () => {
  test('marks ids read without duplicates', () => {
    const { state, changed } = applyMarksOp(
      { ...empty, read: ['A'] },
      { op: 'read', ids: ['A', 'B', 'B'] }
    )
    expect(changed).toBe(true)
    expect(state.read).toEqual(['A', 'B'])
  })

  test('is idempotent', () => {
    const first = applyMarksOp(empty, { op: 'fulfill', ids: ['A'] })
    const second = applyMarksOp(first.state, { op: 'fulfill', ids: ['A'] })
    expect(second.changed).toBe(false)
    expect(second.state).toBe(first.state)
  })

  test('unread and unfulfill remove ids', () => {
    const state: MarksState = { read: ['A', 'B'], fulfilled: ['A'], baselined: false }
    expect(applyMarksOp(state, { op: 'unread', ids: ['A'] }).state.read).toEqual(['B'])
    expect(applyMarksOp(state, { op: 'unfulfill', ids: ['A'] }).state.fulfilled).toEqual([])
  })

  test('removing an unknown id changes nothing', () => {
    expect(applyMarksOp(empty, { op: 'unread', ids: ['X'] }).changed).toBe(false)
  })

  test('baseline applies once', () => {
    const first = applyMarksOp(empty, { op: 'baseline', ids: ['A', 'B'] })
    expect(first.changed).toBe(true)
    expect(first.state).toEqual({ read: ['A', 'B'], fulfilled: [], baselined: true })

    const second = applyMarksOp(first.state, { op: 'baseline', ids: ['C'] })
    expect(second.changed).toBe(false)
    expect(second.state.read).toEqual(['A', 'B'])
  })

  test('an empty baseline still sets baselined', () => {
    const { state, changed } = applyMarksOp(empty, { op: 'baseline', ids: [] })
    expect(changed).toBe(true)
    expect(state.baselined).toBe(true)
  })

  test('caps each kind at the newest ids', () => {
    const { state } = applyMarksOp({ ...empty, read: ['A', 'B'] }, { op: 'read', ids: ['C'] }, 2)
    expect(state.read).toEqual(['B', 'C'])
  })
})
