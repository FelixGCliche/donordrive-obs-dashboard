import type { Donation, Incentive, Snapshot } from '@features/donordrive'

import type { DashboardModel } from './model'
import { selectDashboard } from './selectDashboard'

const MINUTE = 60_000

/** Fixed reference time for the fixtures. */
export const MOCK_NOW = new Date('2026-11-07T20:00:00.000Z')

const ago = (now: Date, minutes: number): string =>
  new Date(now.getTime() - minutes * MINUTE).toISOString()

export const createMockSnapshot = (now: Date = MOCK_NOW): Snapshot => ({
  participant: {
    id: '524337',
    displayName: 'Riley "Healbot" Moreau and the Extra Long Team Name',
    sumDonations: 1840,
    fundraisingGoal: 2500,
    numDonations: 42,
    eventName: 'Extra Life 2026',
  },
  donations: [
    {
      id: 'd-1',
      displayName: 'Marie-Ève Tremblay',
      amount: 50,
      message: 'Play Mercy next round please! Go go go 🎮',
      createdAt: ago(now, 2),
      incentiveId: 'i-hero',
      isTest: false,
    },
    {
      id: 'd-2',
      displayName: 'Anonymous',
      amount: null,
      createdAt: ago(now, 9),
      isTest: false,
    },
    {
      id: 'd-3',
      displayName: 'A donor with an unreasonably long display name that never ends',
      amount: 12.5,
      message:
        'This is a really long message that should be clamped to two lines in the dock because nobody wants a wall of text pushing every other donation off screen during a stream.',
      createdAt: ago(now, 34),
      incentiveId: 'i-hero',
      isTest: false,
    },
    {
      id: 'd-4',
      displayName: 'Sam',
      amount: 25,
      createdAt: ago(now, 75),
      incentiveId: 'i-song',
      isTest: false,
    },
    {
      id: 'd-5',
      displayName: 'Jordan',
      amount: 1000,
      message: 'For the kids!',
      createdAt: ago(now, 60 * 26),
      isTest: false,
    },
  ],
  incentives: [
    {
      id: 'i-hero',
      description: 'Pick my next hero',
      amount: 10,
      isActive: true,
      isTest: false,
    },
    {
      id: 'i-song',
      description: 'Sing a song of your choice, live, badly, with full commitment to the bit',
      amount: 25,
      quantity: 5,
      quantityClaimed: 1,
      isActive: true,
      isTest: false,
    },
    {
      id: 'i-shave',
      description: 'Shave the beard',
      amount: 500,
      quantity: 1,
      quantityClaimed: 1,
      isActive: true,
      isTest: false,
    },
    {
      id: 'i-late',
      description: 'Midnight speedrun',
      amount: 100,
      startsAt: new Date(now.getTime() + 120 * MINUTE).toISOString(),
      isActive: true,
      isTest: false,
    },
    {
      id: 'i-old',
      description: 'Warm-up stream shoutout',
      amount: 5,
      endsAt: ago(now, 60 * 24),
      isActive: true,
      isTest: false,
    },
  ],
  fetchedAt: ago(now, 0.2),
})

export const createMockSandbox = (
  now: Date = MOCK_NOW
): { donations: Donation[]; incentives: Incentive[] } => ({
  donations: [
    {
      id: 'test-1',
      displayName: 'Test donor',
      amount: 20,
      message: 'Testing the hero queue: Soldier 76',
      createdAt: ago(now, 0.5),
      incentiveId: 'i-hero',
      isTest: true,
    },
  ],
  incentives: [],
})

/** A dashboard model with every state the dock UI must handle. */
export const createMockDashboardModel = (now: Date = MOCK_NOW): DashboardModel =>
  selectDashboard({
    snapshot: createMockSnapshot(now),
    sandbox: createMockSandbox(now),
    marks: {
      isRead: (id) => id === 'd-4' || id === 'd-5',
      isFulfilled: (id) => id === 'd-3' || id === 'd-4',
    },
    now,
  })

export const mockDashboardModel: DashboardModel = createMockDashboardModel()
