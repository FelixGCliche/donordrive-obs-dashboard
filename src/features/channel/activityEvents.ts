import type { ActivityItem, DashboardModel } from '@features/dock'

import type { RelayEvent } from './protocol'
import { RELAY_PROTOCOL_VERSION, eventId, relayEventSchema } from './protocol'

/** Relay events for one donation: `donation.created`, plus `incentive.redeemed` when it has one. */
export const activityItemEvents = (item: ActivityItem, participantId: string): RelayEvent[] => {
  const data = {
    donationId: item.id,
    displayName: item.displayName,
    amount: item.amount,
    ...(item.message === undefined ? {} : { message: item.message }),
    ...(item.incentive
      ? { incentiveId: item.incentive.id, incentiveDescription: item.incentive.description }
      : {}),
  }
  const base = { v: RELAY_PROTOCOL_VERSION, ts: item.createdAt, test: item.isTest, participantId }

  const candidates = [
    { ...base, id: eventId('donation.created', item.id), type: 'donation.created' as const, data },
    ...(item.incentive
      ? [
          {
            ...base,
            id: eventId('incentive.redeemed', item.id),
            type: 'incentive.redeemed' as const,
            data,
          },
        ]
      : []),
  ]

  // Drop anything the channel would reject (e.g. oversized ids) instead of posting it
  return candidates.flatMap((event) => {
    const parsed = relayEventSchema.safeParse(event)
    return parsed.success ? [parsed.data] : []
  })
}

export type NewActivityEvents = {
  /** Activity ids not in `seen`, oldest first */
  newIds: string[]
  /** Events to publish for those ids, oldest first */
  events: RelayEvent[]
}

/** Diffs the model's activity against the ids already seen. */
export const newActivityEvents = (
  model: DashboardModel,
  seen: ReadonlySet<string>
): NewActivityEvents => {
  // Activity is newest first; publish oldest first so consumers queue in donation order
  const fresh = model.activity.filter((item) => !seen.has(item.id)).reverse()
  return {
    newIds: fresh.map((item) => item.id),
    events: fresh.flatMap((item) => activityItemEvents(item, model.participant.id)),
  }
}
