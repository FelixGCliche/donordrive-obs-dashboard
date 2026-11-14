import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'

import type { SnapshotCoordinator } from './snapshotCoordinator'
import { createMemorySnapshotStore, createSnapshotCoordinator } from './snapshotCoordinator'
import { getSnapshotInputSchema } from './snapshotInput'
import type { SnapshotEnv } from './snapshotStub'
import { fetchSnapshotObject } from './snapshotStub'
import type { SnapshotResult } from './types'

export { getSnapshotInputSchema, type GetSnapshotInput } from './snapshotInput'

let localCoordinator: SnapshotCoordinator | undefined

/** In-memory fallback for runtimes without the PARTICIPANT_SNAPSHOT binding (e.g. tests). */
const getLocalCoordinator = (): SnapshotCoordinator => {
  if (!localCoordinator) {
    console.warn(
      'PARTICIPANT_SNAPSHOT binding is missing; DonorDrive snapshots use a per-isolate memory cache'
    )
    localCoordinator = createSnapshotCoordinator(createMemorySnapshotStore(), {
      fetch: (input, init) => fetch(input, init),
      now: () => Date.now(),
    })
  }
  return localCoordinator
}

/**
 * Server function proxying the DonorDrive Public API for one participant.
 * Call it as `getSnapshot({ data: { host, pid } })`; it resolves to a `SnapshotResult` and
 * only rejects when the input is invalid or the server is unreachable.
 */
export const getSnapshot = createServerFn({ method: 'GET' })
  .validator(getSnapshotInputSchema)
  .handler(({ data }): Promise<SnapshotResult> => {
    // Narrow the global env to the binding this feature owns; read only inside the handler
    const ns = (env as SnapshotEnv).PARTICIPANT_SNAPSHOT
    return ns ? fetchSnapshotObject(ns, data) : getLocalCoordinator().get(data)
  })
