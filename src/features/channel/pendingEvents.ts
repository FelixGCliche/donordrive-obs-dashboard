import type { Donation, Incentive } from '@features/donordrive'

import { redeemedEvent } from './activityEvents'
import type { RelayEvent } from './protocol'

export type PendingRedemptionsInput = {
  /** Any order; DonorDrive returns newest first */
  donations: readonly Donation[]
  incentives: readonly Incentive[]
  /** Donation ids marked fulfilled in the dock */
  fulfilled: Iterable<string>
  participantId: string
  /** When set, only redemptions of these incentives */
  incentiveIds?: readonly string[]
}

const timeOf = (donation: Donation) => {
  const time = Date.parse(donation.createdAt)
  return Number.isNaN(time) ? 0 : time
}

/**
 * `incentive.redeemed` events for every redemption not marked fulfilled, oldest first.
 * Donations whose incentive isn't in `incentives` are skipped, as the dock does.
 */
export const pendingRedemptionEvents = ({
  donations,
  incentives,
  fulfilled,
  participantId,
  incentiveIds,
}: PendingRedemptionsInput): RelayEvent[] => {
  const done = new Set(fulfilled)
  const wanted = incentiveIds ? new Set(incentiveIds) : undefined
  const incentivesById = new Map(incentives.map((incentive) => [incentive.id, incentive]))

  return donations
    .map((donation, index) => ({ donation, index }))
    .sort((a, b) => timeOf(a.donation) - timeOf(b.donation) || b.index - a.index)
    .flatMap(({ donation }) => {
      if (!donation.incentiveId || done.has(donation.id)) return []
      if (wanted && !wanted.has(donation.incentiveId)) return []
      const incentive = incentivesById.get(donation.incentiveId)
      if (!incentive) return []
      const event = redeemedEvent(donation, incentive, participantId)
      return event ? [event] : []
    })
}
