import { z } from 'zod'

import type { Donation, DonorDriveHost, Incentive } from '@features/donordrive'

// MVP-SHORTCUT(MVP-03): sandbox data lives only in this browser's localStorage, merged client-side
/** Test data a dock adds on top of the live DonorDrive data. */
export type SandboxData = {
  /** Newest first */
  donations: Donation[]
  incentives: Incentive[]
}

export type SandboxDonationInput = {
  displayName: string
  /** null hides the amount, like a donor can */
  amount: number | null
  message?: string
  incentiveId?: string
}

/** Most test donations kept; older ones drop off. */
export const MAX_SANDBOX_DONATIONS = 100

export const EMPTY_SANDBOX: SandboxData = { donations: [], incentives: [] }

const donationSchema = z.object({
  id: z.string().min(1),
  displayName: z.string(),
  amount: z.number().nullable(),
  message: z.string().optional(),
  createdAt: z.string().min(1),
  avatarUrl: z.string().optional(),
  incentiveId: z.string().optional(),
  isTest: z.literal(true),
})

const incentiveSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  amount: z.number(),
  quantity: z.number().optional(),
  quantityClaimed: z.number().optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  isActive: z.boolean(),
  isTest: z.literal(true),
})

/** Stored shape of the sandbox; anything else falls back to an empty sandbox. */
export const sandboxDataSchema: z.ZodType<SandboxData> = z.object({
  donations: z.array(donationSchema),
  incentives: z.array(incentiveSchema),
})

/** localStorage key of a dock's sandbox. */
export const sandboxStorageKey = (host: DonorDriveHost, pid: string) =>
  `ddobs:v1:${host}:${pid}:sandbox`

export const TEST_ID_PREFIX = 'test-'

export const testId = (uuid: string) => `${TEST_ID_PREFIX}${uuid}`

/** Fake incentives shown when the participant has none, so incentive flows can be tried. */
export const FALLBACK_INCENTIVES: Incentive[] = [
  {
    id: testId('incentive'),
    description: 'Test incentive',
    amount: 5,
    isActive: true,
    isTest: true,
  },
  {
    id: testId('pick-a-hero'),
    description: 'Pick a hero',
    amount: 10,
    isActive: true,
    isTest: true,
  },
]

/** The participant's incentives, or fake test ones when there are none. */
export const withFallbackIncentives = (liveIncentives: Incentive[]): Incentive[] =>
  liveIncentives.length > 0 ? liveIncentives : FALLBACK_INCENTIVES

/** Builds a sandbox donation from form input. */
export const createTestDonation = (
  input: SandboxDonationInput,
  { uuid, now }: { uuid: string; now: Date }
): Donation => {
  const message = input.message?.trim()
  return {
    id: testId(uuid),
    displayName: input.displayName.trim() || 'Test donor',
    amount: input.amount,
    ...(message ? { message } : {}),
    ...(input.incentiveId ? { incentiveId: input.incentiveId } : {}),
    createdAt: now.toISOString(),
    isTest: true,
  }
}

/** Prepends a donation, keeping at most MAX_SANDBOX_DONATIONS. */
export const addSandboxDonation = (data: SandboxData, donation: Donation): SandboxData => ({
  ...data,
  donations: [donation, ...data.donations].slice(0, MAX_SANDBOX_DONATIONS),
})

const randomNames = ['Ana', 'Brigitte', 'Cassidy', 'Jamison', 'Lena', 'Mei', 'Reinhardt', 'Zarya']
const randomMessages = ['For the kids!', 'Good luck on stream', 'Keep it up!', 'GG']
const randomHeroes = ['Mercy', 'Genji', 'Lúcio', 'Soldier: 76', 'Kiriko', 'Reaper']
const randomAmounts = [5, 10, 15, 20, 25, 50, 100]

const pick = <T>(items: readonly T[], random: () => number): T =>
  items[Math.floor(random() * items.length) % items.length]

/**
 * Random donation input; redeems one of `incentives` half the time, with at least its amount.
 * A "hero" incentive gets a hero name as the message, like a real redemption would.
 */
export const randomDonationInput = (
  incentives: Incentive[],
  random: () => number = Math.random
): SandboxDonationInput => {
  const displayName = pick(randomNames, random)
  const amount = pick(randomAmounts, random)
  const incentive = incentives.length > 0 && random() < 0.5 ? pick(incentives, random) : undefined
  if (!incentive) {
    return { displayName, amount, message: pick(randomMessages, random) }
  }
  const isHero = /hero/i.test(incentive.description)
  return {
    displayName,
    amount: Math.max(amount, incentive.amount),
    message: isHero ? pick(randomHeroes, random) : pick(randomMessages, random),
    incentiveId: incentive.id,
  }
}
