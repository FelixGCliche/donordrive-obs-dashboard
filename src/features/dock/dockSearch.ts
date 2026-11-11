import { z } from 'zod'

export const PID_PATTERN = /^[A-Za-z0-9-]{1,64}$/
export const DOCK_SEARCH_KEY_PATTERN = /^[A-Za-z0-9_-]{22,64}$/

export const dockHosts = ['extralife', 'try'] as const
export const dockIntervals = [15, 30, 60] as const
export const dockThemes = ['dark', 'light', 'system'] as const
export const dockDensities = ['comfortable', 'compact'] as const

// MVP-SHORTCUT(MVP-01): dock config lives only in the URL; the key holds marks but not config
/** Search params of `/dock`. Every field falls back to a safe default instead of throwing. */
export const dockSearchSchema = z.object({
  /** DonorDrive participant id */
  pid: z.string().regex(PID_PATTERN).optional().catch(undefined),
  host: z.enum(dockHosts).default('extralife').catch('extralife'),
  /** Poll interval, in seconds */
  interval: z.coerce
    .number()
    .pipe(z.union([z.literal(15), z.literal(30), z.literal(60)]))
    .default(30)
    .catch(30),
  theme: z.enum(dockThemes).default('dark').catch('dark'),
  density: z.enum(dockDensities).default('comfortable').catch('comfortable'),
  /** Dock key: required for marks and events */
  key: z.string().regex(DOCK_SEARCH_KEY_PATTERN).optional().catch(undefined),
})

export type DockSearch = z.infer<typeof dockSearchSchema>
export type DockHost = DockSearch['host']
export type DockInterval = DockSearch['interval']
export type DockTheme = DockSearch['theme']
export type DockDensity = DockSearch['density']
