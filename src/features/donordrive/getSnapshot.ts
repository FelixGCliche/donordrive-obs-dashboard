import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { fetchSnapshot } from './fetchSnapshot'
import { DONORDRIVE_PID_PATTERN, donorDriveHostKeys } from './hosts'
import type { SnapshotResult } from './types'

export const getSnapshotInputSchema = z.object({
  host: z.enum(donorDriveHostKeys),
  pid: z.string().regex(DONORDRIVE_PID_PATTERN),
})

export type GetSnapshotInput = z.infer<typeof getSnapshotInputSchema>

/**
 * Server function proxying the DonorDrive Public API for one participant.
 * Call it as `getSnapshot({ data: { host, pid } })`; it resolves to a `SnapshotResult` and
 * only rejects when the input is invalid or the server is unreachable.
 */
export const getSnapshot = createServerFn({ method: 'GET' })
  .validator(getSnapshotInputSchema)
  .handler(({ data }): Promise<SnapshotResult> => fetchSnapshot(data))
