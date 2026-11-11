/** DonorDrive site a participant belongs to; maps to a fixed base URL on the server. */
export type DonorDriveHost = 'extralife' | 'try'

export type ParticipantLinks = {
  /** Public participant page */
  page?: string
  /** Donate page */
  donate?: string
  /** Stream URL, if the participant set one */
  stream?: string
}

export type Participant = {
  id: string
  displayName: string
  /** Total raised, in the campaign currency */
  sumDonations: number
  /** Fundraising goal, in the campaign currency (0 when none is set) */
  fundraisingGoal: number
  numDonations: number
  avatarUrl?: string
  eventName?: string
  links?: ParticipantLinks
}

export type Donation = {
  id: string
  displayName: string
  /** null when the donor hid the amount */
  amount: number | null
  message?: string
  /** ISO 8601 timestamp */
  createdAt: string
  avatarUrl?: string
  /** Set when the donation redeemed an incentive */
  incentiveId?: string
  /** true for sandbox data, never for real DonorDrive data */
  isTest: boolean
}

export type Incentive = {
  id: string
  description: string
  /** Minimum donation amount to redeem it */
  amount: number
  /** Total available; undefined means unlimited */
  quantity?: number
  quantityClaimed?: number
  /** ISO 8601 timestamp */
  startsAt?: string
  /** ISO 8601 timestamp */
  endsAt?: string
  isActive: boolean
  /** true for sandbox data, never for real DonorDrive data */
  isTest: boolean
}

export type Snapshot = {
  participant: Participant
  /** Newest first */
  donations: Donation[]
  incentives: Incentive[]
  /** ISO 8601 timestamp of when the server fetched it */
  fetchedAt: string
}

export type SnapshotErrorKind = 'not_found' | 'rate_limited' | 'upstream' | 'schema'

export type SnapshotError = {
  kind: SnapshotErrorKind
  message: string
  /** Seconds to wait before retrying (from Retry-After on 429) */
  retryAfterSec?: number
}

export type SnapshotResult = { ok: true; snapshot: Snapshot } | { ok: false; error: SnapshotError }
