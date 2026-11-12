import { keepNewest } from './eventBuffer'
import type { MarksOp } from './protocol'

/** Newest ids kept per mark kind. */
export const MARKS_CAP = 2000

export type MarkKind = 'read' | 'fulfilled'

/** Marks without the version; each list is ordered oldest first. */
export type MarksState = {
  read: string[]
  fulfilled: string[]
  baselined: boolean
}

export type MarksOpResult = {
  state: MarksState
  /** false when the op left the state unchanged (e.g. a repeated op or a second baseline) */
  changed: boolean
}

const addIds = (list: readonly string[], ids: readonly string[], cap: number): string[] => {
  const present = new Set(list)
  const added: string[] = []
  for (const id of ids) {
    if (present.has(id)) continue
    present.add(id)
    added.push(id)
  }
  return keepNewest([...list, ...added], cap)
}

const removeIds = (list: readonly string[], ids: readonly string[]): string[] => {
  const removed = new Set(ids)
  return list.filter((id) => !removed.has(id))
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index])

/** Applies a marks op; applying the same op twice leaves the state unchanged. */
export const applyMarksOp = (
  state: MarksState,
  op: MarksOp,
  cap: number = MARKS_CAP
): MarksOpResult => {
  let next: MarksState
  switch (op.op) {
    case 'read':
      next = { ...state, read: addIds(state.read, op.ids, cap) }
      break
    case 'unread':
      next = { ...state, read: removeIds(state.read, op.ids) }
      break
    case 'fulfill':
      next = { ...state, fulfilled: addIds(state.fulfilled, op.ids, cap) }
      break
    case 'unfulfill':
      next = { ...state, fulfilled: removeIds(state.fulfilled, op.ids) }
      break
    case 'baseline':
      if (state.baselined) return { state, changed: false }
      next = { ...state, read: addIds(state.read, op.ids, cap), baselined: true }
      break
  }

  const changed =
    next.baselined !== state.baselined ||
    !sameList(next.read, state.read) ||
    !sameList(next.fulfilled, state.fulfilled)
  return { state: changed ? next : state, changed }
}
