import type { GetSnapshotInput } from '@features/donordrive'
import { getSnapshotInputSchema } from '@features/donordrive'

/** `role` query value a dock socket sends to register its participant for polling. */
export const DOCK_ROLE = 'dock'

/** The participant a dock socket registers, or undefined for non-dock or invalid params. */
export const parseDockRegistration = (params: URLSearchParams): GetSnapshotInput | undefined => {
  if (params.get('role') !== DOCK_ROLE) return undefined
  const parsed = getSnapshotInputSchema.safeParse({
    host: params.get('host') ?? undefined,
    pid: params.get('pid') ?? undefined,
  })
  return parsed.success ? { host: parsed.data.host, pid: parsed.data.pid } : undefined
}
