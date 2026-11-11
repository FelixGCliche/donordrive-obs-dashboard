import { describe, expect, test } from 'bun:test'

import { buildParticipantUrl, isDonorDriveHost } from './hosts'
import type { DonorDriveHost } from './types'

describe('buildParticipantUrl', () => {
  test('builds participant, donations and incentives URLs', () => {
    expect(buildParticipantUrl('extralife', '565094')).toBe(
      'https://www.extra-life.org/api/participants/565094'
    )
    expect(buildParticipantUrl('try', 'some-alias', 'donations', { limit: 50 })).toBe(
      'https://testdrive.donordrive.com/api/participants/some-alias/donations?limit=50'
    )
    expect(buildParticipantUrl('extralife', '1', 'incentives')).toBe(
      'https://www.extra-life.org/api/participants/1/incentives'
    )
  })

  test('rejects unknown hosts and unsafe pids', () => {
    expect(() => buildParticipantUrl('evil' as DonorDriveHost, '1')).toThrow()
    expect(() => buildParticipantUrl('toString' as DonorDriveHost, '1')).toThrow()
    for (const pid of ['', '../events', '1/donations', '1?x=1', '@evil.com', 'a'.repeat(65)]) {
      expect(() => buildParticipantUrl('extralife', pid)).toThrow()
    }
  })

  test('isDonorDriveHost only accepts own keys', () => {
    expect(isDonorDriveHost('extralife')).toBe(true)
    expect(isDonorDriveHost('try')).toBe(true)
    expect(isDonorDriveHost('constructor')).toBe(false)
    expect(isDonorDriveHost(1)).toBe(false)
  })
})
