import type { Marks } from '@features/channel'
import type { Donation, Incentive, Snapshot } from '@features/donordrive'

import type {
  ActivityItem,
  DashboardModel,
  GoalView,
  IncentiveStatus,
  IncentiveView,
} from './model'

/** Read and fulfilled lookups, by donation id. */
export type DashboardMarks = {
  isRead: (donationId: string) => boolean
  isFulfilled: (donationId: string) => boolean
}

export type SandboxData = {
  donations: Donation[]
  incentives: Incentive[]
}

export type SelectDashboardInput = {
  snapshot: Snapshot
  /** Client-side test data, merged into the live data */
  sandbox?: SandboxData
  /** Undefined when the dock has no key: nothing is unread and nothing is fulfilled */
  marks?: DashboardMarks | Marks
  now: Date | number
}

const toLookups = (marks: DashboardMarks | Marks | undefined): DashboardMarks => {
  if (!marks) return { isRead: () => true, isFulfilled: () => false }
  if ('isRead' in marks) return marks

  const read = new Set(marks.read)
  const fulfilled = new Set(marks.fulfilled)
  return { isRead: (id) => read.has(id), isFulfilled: (id) => fulfilled.has(id) }
}

const timeOf = (iso: string | undefined): number => {
  if (!iso) return Number.NaN
  return Date.parse(iso)
}

/** Status of an incentive at `now`, given how many redemptions were seen. */
export const incentiveStatus = (
  incentive: Incentive,
  claimed: number,
  now: number
): IncentiveStatus => {
  const startsAt = timeOf(incentive.startsAt)
  const endsAt = timeOf(incentive.endsAt)

  if (startsAt > now) return 'upcoming'
  if (endsAt <= now) return 'ended'
  if (incentive.quantity !== undefined && claimed >= incentive.quantity) return 'sold_out'
  if (!incentive.isActive) return 'ended'
  return 'active'
}

const dedupeById = <T extends { id: string }>(items: T[]): T[] => {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

/** Combines the snapshot, sandbox data and marks into what the dock renders. */
export const selectDashboard = ({
  snapshot,
  sandbox,
  marks,
  now,
}: SelectDashboardInput): DashboardModel => {
  const lookups = toLookups(marks)
  const nowMs = typeof now === 'number' ? now : now.getTime()

  // MVP-SHORTCUT(MVP-03): sandbox data is client-side only and merged here
  const donations = dedupeById([...snapshot.donations, ...(sandbox?.donations ?? [])])
  const incentives = dedupeById([...snapshot.incentives, ...(sandbox?.incentives ?? [])])
  const incentivesById = new Map(incentives.map((incentive) => [incentive.id, incentive]))

  const testSum = (sandbox?.donations ?? []).reduce(
    (sum, donation) => sum + (donation.amount ?? 0),
    0
  )
  const raised = snapshot.participant.sumDonations + testSum
  const goalAmount = snapshot.participant.fundraisingGoal
  const goal: GoalView = {
    raised,
    goal: goalAmount,
    testSum,
    pct: goalAmount > 0 ? Math.min(100, Math.max(0, (raised / goalAmount) * 100)) : 0,
  }

  const activity: ActivityItem[] = donations
    .map((donation) => {
      const incentive = donation.incentiveId ? incentivesById.get(donation.incentiveId) : undefined
      return {
        id: donation.id,
        displayName: donation.displayName,
        amount: donation.amount,
        message: donation.message,
        createdAt: donation.createdAt,
        avatarUrl: donation.avatarUrl,
        isRead: lookups.isRead(donation.id),
        isTest: donation.isTest,
        incentive: incentive && {
          id: incentive.id,
          description: incentive.description,
          isFulfilled: lookups.isFulfilled(donation.id),
        },
      }
    })
    .sort((a, b) => (timeOf(b.createdAt) || 0) - (timeOf(a.createdAt) || 0))

  const incentiveViews: IncentiveView[] = incentives.map((incentive) => {
    const redemptions = donations.filter((donation) => donation.incentiveId === incentive.id)
    const claimed = redemptions.length
    const pending = redemptions.filter((donation) => !lookups.isFulfilled(donation.id)).length
    // DonorDrive's own count also covers donations older than the fetched page
    const knownClaimed = Math.max(claimed, incentive.quantityClaimed ?? 0)

    return {
      id: incentive.id,
      description: incentive.description,
      amount: incentive.amount,
      status: incentiveStatus(incentive, knownClaimed, nowMs),
      quantity: incentive.quantity,
      claimed: knownClaimed,
      pending,
      startsAt: incentive.startsAt,
      endsAt: incentive.endsAt,
      isTest: incentive.isTest,
    }
  })

  return {
    participant: snapshot.participant,
    goal,
    activity,
    unreadCount: activity.filter((item) => !item.isRead).length,
    incentives: incentiveViews,
    pendingCount: incentiveViews.reduce((sum, incentive) => sum + incentive.pending, 0),
    fetchedAt: snapshot.fetchedAt,
  }
}

/** Newest redemption of an incentive that isn't marked fulfilled yet. */
export const newestPendingRedemption = (
  model: DashboardModel,
  incentiveId: string
): ActivityItem | undefined =>
  model.activity.find((item) => item.incentive?.id === incentiveId && !item.incentive.isFulfilled)
