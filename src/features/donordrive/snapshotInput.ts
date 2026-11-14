import { z } from 'zod'

import { DONORDRIVE_PID_PATTERN, donorDriveHostKeys } from './hosts'

export const getSnapshotInputSchema = z.object({
  host: z.enum(donorDriveHostKeys),
  pid: z.string().regex(DONORDRIVE_PID_PATTERN),
})

export type GetSnapshotInput = z.infer<typeof getSnapshotInputSchema>
