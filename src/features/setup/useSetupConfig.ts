import { z } from 'zod'

import { dockDensities, dockHosts, dockThemes } from '@features/dock'
import { useLocalStorage } from '@hooks'

import { defaultSetupFormValues, type SetupFormValues } from './SetupForm'

/** localStorage key holding the setup form, so reopening setup builds the same URLs */
export const SETUP_CONFIG_STORAGE_KEY = 'ddobs:v1:setup:config'

export type SetupConfig = SetupFormValues

/** Stored setup config; unknown keys (e.g. from older versions) are stripped, not rejected. */
export const setupConfigSchema: z.ZodType<SetupConfig> = z.object({
  pid: z.string(),
  host: z.enum(dockHosts),
  interval: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  theme: z.enum(dockThemes),
  density: z.enum(dockDensities),
})

const defaultSetupConfig: SetupConfig = defaultSetupFormValues

/** Setup form values, persisted in this browser's localStorage. */
export const useSetupConfig = () =>
  useLocalStorage(SETUP_CONFIG_STORAGE_KEY, setupConfigSchema, defaultSetupConfig)
