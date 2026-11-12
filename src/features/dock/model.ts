import type { Participant } from '@features/donordrive'

export type GoalView = {
  /** Live sum plus the sandbox test sum */
  raised: number
  /** 0 when the participant has no goal */
  goal: number
  /** Part of `raised` that comes from sandbox donations */
  testSum: number
  /** 0–100, clamped */
  pct: number
}

export type ActivityIncentive = {
  id: string
  description: string
  /** Whether the streamer marked the redemption as done */
  isFulfilled: boolean
}

export type ActivityItem = {
  /** Donation id */
  id: string
  displayName: string
  /** null when the donor hid the amount */
  amount: number | null
  message?: string
  /** ISO 8601 timestamp */
  createdAt: string
  avatarUrl?: string
  isRead: boolean
  isTest: boolean
  /** Set when the donation redeemed an incentive */
  incentive?: ActivityIncentive
}

export type IncentiveStatus = 'active' | 'upcoming' | 'ended' | 'sold_out'

export type IncentiveView = {
  id: string
  description: string
  amount: number
  status: IncentiveStatus
  /** Undefined means unlimited */
  quantity?: number
  /** Redemptions seen so far */
  claimed: number
  /** Redemptions not yet marked fulfilled */
  pending: number
  /** ISO 8601 timestamp */
  startsAt?: string
  /** ISO 8601 timestamp */
  endsAt?: string
  isTest: boolean
}

export type DashboardModel = {
  participant: Participant
  goal: GoalView
  /** Newest first */
  activity: ActivityItem[]
  unreadCount: number
  incentives: IncentiveView[]
  /** Total unfulfilled redemptions across all incentives */
  pendingCount: number
  /** ISO 8601 timestamp of the snapshot */
  fetchedAt: string
}
