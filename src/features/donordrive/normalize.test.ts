import { describe, expect, test } from 'bun:test'

import {
  ANONYMOUS_DONOR,
  normalizeIncentive,
  parseSnapshot,
  rawIncentiveSchema,
  toIsoDate,
} from './schemas'
import {
  rawDonationsFixture,
  rawIncentivesFixture,
  rawParticipantFixture,
} from './snapshotFixtures'

const fetchedAt = new Date('2026-11-11T12:00:00.000Z')

const parseFixtures = () => {
  const result = parseSnapshot(
    {
      participant: rawParticipantFixture,
      donations: rawDonationsFixture,
      incentives: rawIncentivesFixture,
    },
    fetchedAt
  )
  if (!result.ok) throw new Error(result.message)
  return result.snapshot
}

describe('toIsoDate', () => {
  test('normalizes DonorDrive offsets without a colon', () => {
    expect(toIsoDate('2026-11-11T00:06:51.767+0000')).toBe('2026-11-11T00:06:51.767Z')
    expect(toIsoDate('2026-11-09T00:47:08.17+0000')).toBe('2026-11-09T00:47:08.170Z')
    expect(toIsoDate('2021-04-14T07:00:00.0-0500')).toBe('2021-04-14T12:00:00.000Z')
  })

  test('treats a missing zone as UTC and rejects garbage', () => {
    expect(toIsoDate('2026-11-11T00:00:00')).toBe('2026-11-11T00:00:00.000Z')
    expect(toIsoDate('2026-11-11T00:00:00Z')).toBe('2026-11-11T00:00:00.000Z')
    expect(toIsoDate('not a date')).toBeUndefined()
    expect(toIsoDate(null)).toBeUndefined()
    expect(toIsoDate('')).toBeUndefined()
  })
})

describe('parseSnapshot', () => {
  test('normalizes the participant', () => {
    expect(parseFixtures().participant).toEqual({
      id: '500001',
      displayName: 'Example Streamer',
      sumDonations: 1234.56,
      fundraisingGoal: 5000,
      numDonations: 4,
      avatarUrl: 'https://donordrivecontent.com/extralife/images/$avatars$/example.jpg',
      eventName: 'Extra Life 2026',
      links: {
        page: 'https://dd.extra-life.org/participants/example-streamer',
        donate: 'https://dd.extra-life.org/participants/example-streamer/donate',
        stream: 'https://www.youtube.com/watch?v=example',
      },
    })
  })

  test('normalizes donations, newest first', () => {
    const { donations } = parseFixtures()
    expect(donations.map((d) => d.id)).toEqual([
      'A000000000000001',
      'A000000000000002',
      'A000000000000003',
      'A000000000000004',
    ])
    expect(donations[0]).toMatchObject({
      displayName: 'Donor One',
      amount: 70,
      message: 'Placeholder message one',
      createdAt: '2026-11-11T00:06:51.767Z',
      isTest: false,
    })
    expect(donations[0].incentiveId).toBeUndefined()
    expect(donations[1].incentiveId).toBe('00000000-0000-0000-0000000000000001')
    expect(donations[2].displayName).toBe(ANONYMOUS_DONOR)
    expect(donations[2].message).toBeUndefined()
    expect(donations[3].amount).toBeNull()
    expect(donations[3].message).toBeUndefined()
    expect(donations.every((d) => !d.isTest)).toBe(true)
  })

  test('sorts donations newest first even when the API order differs', () => {
    const result = parseSnapshot(
      {
        participant: rawParticipantFixture,
        donations: [...rawDonationsFixture].reverse(),
        incentives: [],
      },
      fetchedAt
    )
    expect(result.ok && result.snapshot.donations.map((d) => d.id)[0]).toBe('A000000000000001')
  })

  test('normalizes incentives', () => {
    const { incentives, fetchedAt: at } = parseFixtures()
    expect(at).toBe('2026-11-11T12:00:00.000Z')
    expect(incentives).toEqual([
      {
        id: '00000000-0000-0000-0000000000000001',
        description: 'Choose the next challenge',
        amount: 25,
        quantity: 5,
        quantityClaimed: 1,
        startsAt: undefined,
        endsAt: undefined,
        isActive: true,
        isTest: false,
      },
      {
        id: '00000000-0000-0000-0000000000000002',
        description: 'Placeholder challenge',
        amount: 300,
        quantity: 1,
        quantityClaimed: 0,
        startsAt: '2026-11-01T07:00:00.000Z',
        endsAt: '2026-11-30T07:00:00.000Z',
        isActive: true,
        isTest: false,
      },
    ])
  })

  test('reports schema failures instead of throwing', () => {
    const result = parseSnapshot(
      { participant: { displayName: 'x' }, donations: [], incentives: [] },
      fetchedAt
    )
    expect(result.ok).toBe(false)
    expect(!result.ok && result.message).toContain('participant')

    const badDate = parseSnapshot(
      {
        participant: rawParticipantFixture,
        donations: [{ ...rawDonationsFixture[0], createdDateUTC: 'nope' }],
        incentives: [],
      },
      fetchedAt
    )
    expect(!badDate.ok && badDate.message).toContain('donations response at 0.createdDateUTC')

    expect(
      parseSnapshot(
        { participant: rawParticipantFixture, donations: {}, incentives: [] },
        fetchedAt
      ).ok
    ).toBe(false)
  })
})

describe('normalizeIncentive', () => {
  const base = rawIncentiveSchema.parse({ incentiveID: 'i', description: 'd', amount: 10 })
  const now = new Date('2026-11-11T12:00:00Z')

  test('missing quantity means unlimited with none claimed', () => {
    expect(normalizeIncentive(base, now)).toMatchObject({
      quantity: undefined,
      quantityClaimed: 0,
      isActive: true,
    })
  })

  test('sold out is inactive even when the API says active', () => {
    expect(
      normalizeIncentive({ ...base, quantity: 2, quantityClaimed: 2, isActive: true }, now).isActive
    ).toBe(false)
  })

  test('respects the API isActive flag', () => {
    expect(normalizeIncentive({ ...base, isActive: false }, now).isActive).toBe(false)
  })

  test('falls back to the date window without isActive', () => {
    expect(
      normalizeIncentive({ ...base, endDateUTC: '2026-11-10T00:00:00.0+0000' }, now).isActive
    ).toBe(false)
    expect(
      normalizeIncentive({ ...base, startDateUTC: '2026-11-12T00:00:00.0+0000' }, now).isActive
    ).toBe(false)
    expect(
      normalizeIncentive(
        {
          ...base,
          startDateUTC: '2026-11-10T00:00:00.0+0000',
          endDateUTC: '2026-11-12T00:00:00.0+0000',
        },
        now
      ).isActive
    ).toBe(true)
  })
})
