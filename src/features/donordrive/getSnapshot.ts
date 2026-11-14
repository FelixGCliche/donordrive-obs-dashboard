import { createServerFn } from '@tanstack/react-start'

import { fetchSnapshot } from './fetchSnapshot'
import { getSnapshotInputSchema } from './snapshotInput'
import type { SnapshotResult } from './types'

export { getSnapshotInputSchema, type GetSnapshotInput } from './snapshotInput'

/**
 * Server function proxying the DonorDrive Public API for one participant.
 * Call it as `getSnapshot({ data: { host, pid } })`; it resolves to a `SnapshotResult` and
 * only rejects when the input is invalid or the server is unreachable.
 */
export const getSnapshot = createServerFn({ method: 'GET' })
  .validator(getSnapshotInputSchema)
  .handler(({ data }): Promise<SnapshotResult> => fetchSnapshot(data))
