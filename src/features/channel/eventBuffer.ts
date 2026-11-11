import type { RelayEvent } from './protocol'

/** Events replayed to a socket that (re)connects. */
export const REPLAY_LIMIT = 50

/** Event ids remembered for dedupe; larger than the replay window so late duplicates still drop. */
export const DEDUPE_LIMIT = 1000

/** Keeps the newest `limit` items of a list ordered oldest first. */
export const keepNewest = <T>(items: readonly T[], limit: number): T[] =>
  items.length > limit ? items.slice(items.length - limit) : [...items]

/**
 * Events to replay to a socket, oldest first.
 * Only events after `since` when it is in the replay window, otherwise the whole window.
 */
export const selectReplay = (
  events: readonly RelayEvent[],
  since: string | null | undefined,
  limit: number = REPLAY_LIMIT
): RelayEvent[] => {
  const window = keepNewest(events, limit)
  if (!since) return window
  const index = window.findIndex((event) => event.id === since)
  return index === -1 ? window : window.slice(index + 1)
}
