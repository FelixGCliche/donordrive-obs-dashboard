import { z } from 'zod'

import type { Donation, Incentive, Participant, ParticipantLinks, Snapshot } from './types'

/**
 * DonorDrive dates look like `2026-11-11T00:06:51.767+0000`: an offset without a colon,
 * which not every runtime parses. Returns a normalized ISO 8601 UTC string, or undefined.
 */
export const toIsoDate = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined
  const withColon = value.trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
  const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(withColon)
  const date = new Date(hasZone ? withColon : `${withColon}Z`)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

const dateString = z.string().refine((value) => toIsoDate(value) !== undefined, 'Invalid date')
const id = z.union([z.string().min(1), z.number()]).transform(String)
const optionalString = z.string().nullish()
const optionalNumber = z.number().nullish()

// Schemas are loose: unknown keys pass through, and anything the API may omit is optional.

export const rawParticipantSchema = z.looseObject({
  participantID: id,
  displayName: z.string(),
  sumDonations: optionalNumber,
  fundraisingGoal: optionalNumber,
  numDonations: optionalNumber,
  avatarImageURL: optionalString,
  eventName: optionalString,
  links: z
    .looseObject({
      page: optionalString,
      donate: optionalString,
      stream: optionalString,
    })
    .nullish(),
})

export const rawDonationSchema = z.looseObject({
  donationID: id,
  /** Missing for anonymous donors */
  displayName: optionalString,
  /** Missing or null when the donor hid the amount */
  amount: optionalNumber,
  message: optionalString,
  createdDateUTC: dateString,
  avatarImageURL: optionalString,
  incentiveID: optionalString,
})

export const rawIncentiveSchema = z.looseObject({
  incentiveID: id,
  description: z.string(),
  amount: z.number(),
  /** Missing means unlimited */
  quantity: optionalNumber,
  /** Missing means unlimited and none claimed */
  quantityClaimed: optionalNumber,
  startDateUTC: dateString.nullish(),
  endDateUTC: dateString.nullish(),
  /** Added in API 1.2 */
  isActive: z.boolean().nullish(),
})

export const rawDonationsSchema = z.array(rawDonationSchema)
export const rawIncentivesSchema = z.array(rawIncentiveSchema)

export type RawParticipant = z.infer<typeof rawParticipantSchema>
export type RawDonation = z.infer<typeof rawDonationSchema>
export type RawIncentive = z.infer<typeof rawIncentiveSchema>

export const ANONYMOUS_DONOR = 'Anonymous'

const nonEmpty = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

const normalizeLinks = (links: RawParticipant['links']): ParticipantLinks | undefined => {
  if (!links) return undefined
  const result: ParticipantLinks = {}
  const page = nonEmpty(links.page)
  const donate = nonEmpty(links.donate)
  const stream = nonEmpty(links.stream)
  if (page) result.page = page
  if (donate) result.donate = donate
  if (stream) result.stream = stream
  return Object.keys(result).length > 0 ? result : undefined
}

export const normalizeParticipant = (raw: RawParticipant): Participant => ({
  id: raw.participantID,
  displayName: raw.displayName,
  sumDonations: raw.sumDonations ?? 0,
  fundraisingGoal: raw.fundraisingGoal ?? 0,
  numDonations: raw.numDonations ?? 0,
  avatarUrl: nonEmpty(raw.avatarImageURL),
  eventName: nonEmpty(raw.eventName),
  links: normalizeLinks(raw.links),
})

export const normalizeDonation = (raw: RawDonation): Donation => ({
  id: raw.donationID,
  displayName: nonEmpty(raw.displayName) ?? ANONYMOUS_DONOR,
  amount: raw.amount ?? null,
  message: nonEmpty(raw.message),
  // The schema already checked the date parses
  createdAt: toIsoDate(raw.createdDateUTC) as string,
  avatarUrl: nonEmpty(raw.avatarImageURL),
  incentiveId: nonEmpty(raw.incentiveID),
  isTest: false,
})

/**
 * `isActive` comes from the API when present (1.2+), otherwise from the start/end window.
 * Either way, an incentive with no quantity left is inactive.
 */
export const normalizeIncentive = (raw: RawIncentive, now: Date = new Date()): Incentive => {
  const startsAt = toIsoDate(raw.startDateUTC)
  const endsAt = toIsoDate(raw.endDateUTC)
  const quantity = raw.quantity ?? undefined
  const quantityClaimed = raw.quantityClaimed ?? 0
  const soldOut = quantity !== undefined && quantityClaimed >= quantity
  const inWindow =
    (!startsAt || Date.parse(startsAt) <= now.getTime()) &&
    (!endsAt || Date.parse(endsAt) > now.getTime())

  return {
    id: raw.incentiveID,
    description: raw.description,
    amount: raw.amount,
    quantity,
    quantityClaimed,
    startsAt,
    endsAt,
    isActive: (raw.isActive ?? inWindow) && !soldOut,
    isTest: false,
  }
}

/** Newest first; ties keep API order */
export const normalizeDonations = (raw: RawDonation[]): Donation[] =>
  raw
    .map(normalizeDonation)
    .map((donation, index) => ({ donation, index }))
    .sort(
      (a, b) =>
        Date.parse(b.donation.createdAt) - Date.parse(a.donation.createdAt) || a.index - b.index
    )
    .map(({ donation }) => donation)

/** Cheapest first */
export const normalizeIncentives = (raw: RawIncentive[], now: Date = new Date()): Incentive[] =>
  raw.map((incentive) => normalizeIncentive(incentive, now)).sort((a, b) => a.amount - b.amount)

export type RawSnapshotParts = {
  participant: unknown
  donations: unknown
  incentives: unknown
}

export type ParseSnapshotResult = { ok: true; snapshot: Snapshot } | { ok: false; message: string }

const schemaFailure = (name: string, error: z.ZodError): ParseSnapshotResult => {
  const issue = error.issues[0]
  const path = issue?.path.join('.') || '(root)'
  return {
    ok: false,
    message: `Unexpected DonorDrive ${name} response at ${path}: ${issue?.message ?? 'invalid'}`,
  }
}

/** Validates the three raw responses and normalizes them into a `Snapshot`. Never throws. */
export const parseSnapshot = (parts: RawSnapshotParts, fetchedAt: Date): ParseSnapshotResult => {
  const participant = rawParticipantSchema.safeParse(parts.participant)
  const donations = rawDonationsSchema.safeParse(parts.donations)
  const incentives = rawIncentivesSchema.safeParse(parts.incentives)

  if (!participant.success) return schemaFailure('participant', participant.error)
  if (!donations.success) return schemaFailure('donations', donations.error)
  if (!incentives.success) return schemaFailure('incentives', incentives.error)

  return {
    ok: true,
    snapshot: {
      participant: normalizeParticipant(participant.data),
      donations: normalizeDonations(donations.data),
      incentives: normalizeIncentives(incentives.data, fetchedAt),
      fetchedAt: fetchedAt.toISOString(),
    },
  }
}
