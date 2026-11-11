import type { DonorDriveHost } from './types'

// MVP-SHORTCUT(MVP-08): two hard-coded DonorDrive hosts; other charities can't use the dock
/**
 * Fixed base URL for each DonorDrive site. Clients only ever send a host key, never a URL,
 * so the server can't be pointed at arbitrary origins (SSRF).
 */
export const donorDriveHosts = {
  extralife: 'https://www.extra-life.org',
  // try.donordrive.com is a marketing site without the API; testdrive is DonorDrive's demo instance
  try: 'https://testdrive.donordrive.com',
} as const satisfies Record<DonorDriveHost, string>

export const donorDriveHostKeys = Object.keys(donorDriveHosts) as [
  DonorDriveHost,
  ...DonorDriveHost[],
]

/** Participant id or URL alias accepted by the DonorDrive API */
export const DONORDRIVE_PID_PATTERN = /^[A-Za-z0-9-]{1,64}$/

export const isDonorDriveHost = (value: unknown): value is DonorDriveHost =>
  typeof value === 'string' && Object.hasOwn(donorDriveHosts, value)

export type ParticipantResource = 'participant' | 'donations' | 'incentives'

/**
 * Builds a DonorDrive Public API URL from a host key and a participant id only.
 * Throws when either is invalid, so untrusted input can't reach other paths or origins.
 */
export const buildParticipantUrl = (
  host: DonorDriveHost,
  pid: string,
  resource: ParticipantResource = 'participant',
  params?: Record<string, string | number>
): string => {
  if (!isDonorDriveHost(host)) throw new Error(`Unknown DonorDrive host: ${String(host)}`)
  if (!DONORDRIVE_PID_PATTERN.test(pid)) throw new Error('Invalid DonorDrive participant id')

  const path = resource === 'participant' ? '' : `/${resource}`
  const url = new URL(`/api/participants/${pid}${path}`, donorDriveHosts[host])
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}
