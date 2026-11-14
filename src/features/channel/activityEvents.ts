import type { ActivityItem, DashboardModel } from '@features/dock'

import type { RelayEvent, RelayEventType } from './protocol'
import { RELAY_PROTOCOL_VERSION, eventId, relayEventSchema } from './protocol'

/** Fields of a donation that relay events carry. */
export type EventDonation = {
  /** Donation id */
  id: string
  displayName: string
  amount: number | null
  message?: string
  /** ISO 8601 timestamp */
  createdAt: string
  isTest: boolean
}

export type EventIncentive = { id: string; description: string }

/** Unvalidated event for one donation; `incentive` adds the incentive fields to `data`. */
const buildEvent = (
  type: RelayEventType,
  donation: EventDonation,
  participantId: string,
  incentive?: EventIncentive
) => ({
  v: RELAY_PROTOCOL_VERSION,
  id: eventId(type, donation.id),
  type,
  ts: donation.createdAt,
  test: donation.isTest,
  participantId,
  data: {
    donationId: donation.id,
    displayName: donation.displayName,
    amount: donation.amount,
    ...(donation.message === undefined ? {} : { message: donation.message }),
    ...(incentive
      ? { incentiveId: incentive.id, incentiveDescription: incentive.description }
      : {}),
  },
})

/** Validates against the channel schema; undefined for anything the channel would reject. */
const validEvent = (event: unknown): RelayEvent | undefined => {
  const parsed = relayEventSchema.safeParse(event)
  return parsed.success ? parsed.data : undefined
}

/** `incentive.redeemed` event for a donation that redeemed `incentive`, or undefined if invalid. */
export const redeemedEvent = (
  donation: EventDonation,
  incentive: EventIncentive,
  participantId: string
): RelayEvent | undefined =>
  validEvent(buildEvent('incentive.redeemed', donation, participantId, incentive))

/** Relay events for one donation: `donation.created`, plus `incentive.redeemed` when it has one. */
export const activityItemEvents = (item: ActivityItem, participantId: string): RelayEvent[] => {
  // Drop anything the channel would reject (e.g. oversized ids) instead of posting it
  const created = validEvent(buildEvent('donation.created', item, participantId, item.incentive))
  const redeemed = item.incentive ? redeemedEvent(item, item.incentive, participantId) : undefined
  return [created, redeemed].filter((event): event is RelayEvent => event !== undefined)
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
