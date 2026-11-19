import { z } from 'zod'

export const PID_PATTERN = /^[A-Za-z0-9-]{1,64}$/
// Copies of CHANNEL_ID_PATTERN and OWNER_KEY_PATTERN from @features/channel. Importing that barrel
// here would pull Worker-only modules into the route's search validation (and its tests).
/** Channel ID format (22 base64url characters). */
export const DOCK_SEARCH_CHANNEL_PATTERN = /^[A-Za-z0-9_-]{22}$/
/** Owner key format; the dock writes marks and publishes events, so it needs the owner key. */
export const DOCK_SEARCH_KEY_PATTERN = /^own_[A-Za-z0-9_-]{43}$/

export const dockHosts = ['extralife', 'try'] as const
export const dockIntervals = [15, 30, 60] as const
export const dockThemes = ['dark', 'light', 'system'] as const
export const dockDensities = ['comfortable', 'compact'] as const

/**
 * TanStack Router JSON-parses search values, so an all-digit pid arrives as a number.
 * Accept numbers and turn them back into strings before validating.
 */
const searchString = (pattern: RegExp) =>
  z
    .union([z.string(), z.number()])
    .transform(String)
    .pipe(z.string().regex(pattern))
    .optional()
    .catch(undefined)

// MVP-SHORTCUT(MVP-01): dock config lives only in the URL; the channel holds marks but not config
/** Search params of `/dock`. Every field falls back to a safe default instead of throwing. */
export const dockSearchSchema = z.object({
  /** DonorDrive participant id */
  pid: searchString(PID_PATTERN),
  host: z.enum(dockHosts).default('extralife').catch('extralife'),
  /** Poll interval, in seconds */
  interval: z.coerce
    .number()
    .pipe(z.union([z.literal(15), z.literal(30), z.literal(60)]))
    .default(30)
    .catch(30),
  theme: z.enum(dockThemes).default('dark').catch('dark'),
  density: z.enum(dockDensities).default('comfortable').catch('comfortable'),
  /** Channel ID: required for marks and events */
  channel: searchString(DOCK_SEARCH_CHANNEL_PATTERN),
  /** Owner key of the channel: required for marks and events */
  key: searchString(DOCK_SEARCH_KEY_PATTERN),
})

export type DockSearch = z.infer<typeof dockSearchSchema>
export type DockHost = DockSearch['host']
export type DockInterval = DockSearch['interval']
export type DockTheme = DockSearch['theme']
export type DockDensity = DockSearch['density']
