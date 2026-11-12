import { describe, expect, test } from 'bun:test'

import type { Incentive } from '@features/donordrive'
import { parseStoredValue, serializeValue } from '@hooks'

import {
  addSandboxDonation,
  createTestDonation,
  EMPTY_SANDBOX,
  FALLBACK_INCENTIVES,
  MAX_SANDBOX_DONATIONS,
  parseAmountField,
  randomDonationInput,
  sandboxDataSchema,
  sandboxStorageKey,
  withFallbackIncentives,
} from './sandboxData'

const now = new Date('2026-11-07T18:00:00.000Z')

const liveIncentive: Incentive = {
  id: 'I1',
  description: 'Choose the next challenge',
  amount: 25,
  isActive: true,
  isTest: false,
}

/** Deterministic random sequence */
const sequence = (...values: number[]) => {
  let index = 0
  return () => values[index++ % values.length]
}

describe('sandboxStorageKey', () => {
  test('scopes by host and pid', () => {
    expect(sandboxStorageKey('extralife', '123')).toBe('ddobs:v1:extralife:123:sandbox')
  })
})

describe('createTestDonation', () => {
  test('builds a test donation with a test id', () => {
    const donation = createTestDonation(
      { displayName: ' Ana ', amount: 10, message: ' Hi ', incentiveId: 'I1' },
      { uuid: 'abc', now }
    )
    expect(donation).toEqual({
      id: 'test-abc',
      displayName: 'Ana',
      amount: 10,
      message: 'Hi',
      incentiveId: 'I1',
      createdAt: '2026-11-07T18:00:00.000Z',
      isTest: true,
    })
  })

  test('defaults the name and drops empty optional fields', () => {
    const donation = createTestDonation(
      { displayName: '', amount: null, message: '  ' },
      { uuid: 'x', now }
    )
    expect(donation.displayName).toBe('Test donor')
    expect('message' in donation).toBe(false)
    expect('incentiveId' in donation).toBe(false)
  })
})

describe('addSandboxDonation', () => {
  test('prepends and caps the list', () => {
    let data = EMPTY_SANDBOX
    for (let i = 0; i < MAX_SANDBOX_DONATIONS + 3; i++) {
      data = addSandboxDonation(
        data,
        createTestDonation({ displayName: `D${i}`, amount: 1 }, { uuid: `${i}`, now })
      )
    }
    expect(data.donations).toHaveLength(MAX_SANDBOX_DONATIONS)
    expect(data.donations[0].id).toBe(`test-${MAX_SANDBOX_DONATIONS + 2}`)
  })
})

describe('withFallbackIncentives', () => {
  test('keeps live incentives', () => {
    expect(withFallbackIncentives([liveIncentive])).toEqual([liveIncentive])
  })

  test('adds fake test incentives when there are none', () => {
    const incentives = withFallbackIncentives([])
    expect(incentives).toBe(FALLBACK_INCENTIVES)
    expect(incentives.map((incentive) => incentive.description)).toEqual([
      'Test incentive',
      'Test limited incentive',
    ])
    expect(incentives.every((incentive) => incentive.isTest)).toBe(true)
  })
})

describe('randomDonationInput', () => {
  test('makes a plain donation without incentives', () => {
    const input = randomDonationInput([], sequence(0, 0, 0))
    expect(input.incentiveId).toBeUndefined()
    expect(input.amount).toBe(5)
  })

  test('redeems an incentive with at least its amount and a message', () => {
    // name, amount, redeem roll (< 0.5), incentive pick, message pick
    const input = randomDonationInput([liveIncentive], sequence(0, 0, 0.1, 0, 0))
    expect(input.incentiveId).toBe('I1')
    expect(input.amount).toBe(25)
    expect(input.message).toBe('For the kids!')
  })
})

describe('parseAmountField', () => {
  test('treats an empty field as a hidden amount', () => {
    expect(parseAmountField('  ')).toEqual({ ok: true, amount: null })
  })

  test('accepts non-negative numbers', () => {
    expect(parseAmountField('12.5')).toEqual({ ok: true, amount: 12.5 })
    expect(parseAmountField('0')).toEqual({ ok: true, amount: 0 })
  })

  test('rejects negatives and text', () => {
    expect(parseAmountField('-1')).toEqual({ ok: false })
    expect(parseAmountField('ten')).toEqual({ ok: false })
  })
})

describe('sandboxDataSchema', () => {
  test('round-trips stored data', () => {
    const data = addSandboxDonation(
      EMPTY_SANDBOX,
      createTestDonation({ displayName: 'Ana', amount: 5 }, { uuid: 'a', now })
    )
    expect(parseStoredValue(serializeValue(data), sandboxDataSchema, EMPTY_SANDBOX)).toEqual(data)
  })

  test('rejects live (non-test) data', () => {
    const raw = serializeValue({ donations: [], incentives: [liveIncentive] })
    expect(parseStoredValue(raw, sandboxDataSchema, EMPTY_SANDBOX)).toBe(EMPTY_SANDBOX)
  })
})
