import type { Snapshot } from '@features/donordrive'

import type { EventItem } from './activityEvents'
import { newItemEvents } from './activityEvents'
import type { RelayEvent } from './protocol'

/** How long a donation naming an unknown incentive waits for the incentive list to catch up. */
export const INCENTIVE_GRACE_MS = 6 * 60 * 1000

const timeOf = (iso: string): number => Date.parse(iso)

/** Live donations as event items, newest first, with incentives resolved by id. */
export const snapshotEventItems = (snapshot: Snapshot): EventItem[] => {
  const incentivesById = new Map(snapshot.incentives.map((incentive) => [incentive.id, incentive]))
  return snapshot.donations
    .filter((donation) => !donation.isTest)
    .map((donation): EventItem => {
      const incentive = donation.incentiveId ? incentivesById.get(donation.incentiveId) : undefined
      return {
        id: donation.id,
        displayName: donation.displayName,
        amount: donation.amount,
        ...(donation.message === undefined ? {} : { message: donation.message }),
        createdAt: donation.createdAt,
        isTest: donation.isTest,
        ...(incentive
          ? { incentive: { id: incentive.id, description: incentive.description } }
          : {}),
      }
    })
    .sort((a, b) => (timeOf(b.createdAt) || 0) - (timeOf(a.createdAt) || 0))
}

export type PollDiff = {
  /** Donation ids to remember as seen */
  seenIds: string[]
  /** Events to publish, oldest first */
  events: RelayEvent[]
}

/**
 * Diffs a polled snapshot against the donation ids already seen. A baseline poll only marks
 * everything seen. A recent donation naming an incentive the snapshot doesn't list yet is
 * deferred (neither seen nor published) so a later poll can publish its redemption.
 */
export const diffSnapshot = (
  snapshot: Snapshot,
  seen: ReadonlySet<string>,
  baseline: boolean,
  now: number
): PollDiff => {
  const items = snapshotEventItems(snapshot)
  if (baseline) return { seenIds: items.map((item) => item.id), events: [] }

  const incentiveIds = new Map(
    snapshot.donations.map((donation) => [donation.id, donation.incentiveId])
  )
  const isDeferred = (item: EventItem): boolean =>
    !item.incentive &&
    Boolean(incentiveIds.get(item.id)) &&
    now - timeOf(item.createdAt) < INCENTIVE_GRACE_MS

  const ready = items.filter((item) => !isDeferred(item))
  const { newIds, events } = newItemEvents(ready, snapshot.participant.id, seen)
  return { seenIds: newIds, events }
}
