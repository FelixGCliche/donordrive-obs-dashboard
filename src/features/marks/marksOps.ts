import type { Marks, MarksOp } from '@features/channel'

const addIds = (list: string[], ids: string[]): string[] => {
  const present = new Set(list)
  const added = ids.filter((id) => !present.has(id))
  return added.length === 0 ? list : [...list, ...added]
}

const removeIds = (list: string[], ids: string[]): string[] => {
  const removed = new Set(ids)
  const kept = list.filter((id) => !removed.has(id))
  return kept.length === list.length ? list : kept
}

/**
 * Applies a marks op the way the channel does, for optimistic updates.
 * Leaves `version` alone: only the server bumps it, so its next state always wins.
 * Returns the same object when the op changes nothing.
 */
export const applyMarksOp = (marks: Marks, op: MarksOp): Marks => {
  switch (op.op) {
    case 'read': {
      const read = addIds(marks.read, op.ids)
      return read === marks.read ? marks : { ...marks, read }
    }
    case 'unread': {
      const read = removeIds(marks.read, op.ids)
      return read === marks.read ? marks : { ...marks, read }
    }
    case 'fulfill': {
      const fulfilled = addIds(marks.fulfilled, op.ids)
      return fulfilled === marks.fulfilled ? marks : { ...marks, fulfilled }
    }
    case 'unfulfill': {
      const fulfilled = removeIds(marks.fulfilled, op.ids)
      return fulfilled === marks.fulfilled ? marks : { ...marks, fulfilled }
    }
    case 'baseline': {
      if (marks.baselined) return marks
      return { ...marks, read: addIds(marks.read, op.ids), baselined: true }
    }
  }
}

/** Whether server marks should replace the cached state: only when they are not older. */
export const shouldReplaceMarks = (cached: Marks | undefined, incoming: Marks): boolean =>
  cached === undefined || incoming.version >= cached.version
