import { useCallback } from 'react'

import type { Donation, DonorDriveHost, Incentive } from '@features/donordrive'
import { useLocalStorage } from '@hooks'

import {
  addSandboxDonation,
  createTestDonation,
  EMPTY_SANDBOX,
  randomDonationInput,
  sandboxDataSchema,
  sandboxStorageKey,
} from './sandboxData'
import type { SandboxDonationInput } from './sandboxData'

export type UseSandboxOptions = {
  host: DonorDriveHost
  /** DonorDrive participant id; the sandbox is read-only and empty while it is undefined */
  pid: string | undefined
}

export type UseSandboxResult = {
  /** Test donations, newest first */
  donations: Donation[]
  /** Test incentives stored with the sandbox (fallback ones come from withFallbackIncentives) */
  incentives: Incentive[]
  addDonation: (input: SandboxDonationInput) => void
  /** Adds a random donation, redeeming one of `incentives` half the time */
  addRandom: (incentives?: Incentive[]) => void
  clear: () => void
}

/** Per-dock test data, persisted in localStorage under `ddobs:v1:{host}:{pid}:sandbox`. */
export const useSandbox = ({ host, pid }: UseSandboxOptions): UseSandboxResult => {
  // Without a pid nothing is written, so this placeholder key only ever reads empty
  const storageKey = sandboxStorageKey(host, pid ?? '')
  const [data, setData, removeData] = useLocalStorage(storageKey, sandboxDataSchema, EMPTY_SANDBOX)

  const addDonation = useCallback(
    (input: SandboxDonationInput) => {
      if (!pid) return
      const donation = createTestDonation(input, { uuid: crypto.randomUUID(), now: new Date() })
      setData((previous) => addSandboxDonation(previous, donation))
    },
    [pid, setData]
  )

  const addRandom = useCallback(
    (incentives: Incentive[] = []) => addDonation(randomDonationInput(incentives)),
    [addDonation]
  )

  const clear = useCallback(() => {
    if (pid) removeData()
  }, [pid, removeData])

  return {
    donations: data.donations,
    incentives: data.incentives,
    addDonation,
    addRandom,
    clear,
  }
}
