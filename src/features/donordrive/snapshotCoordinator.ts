import type { UpstreamDeps } from './donorDriveFetch'
import type { GetSnapshotInput } from './snapshotInput'
import {
  emptySnapshotState,
  readFreshSnapshot,
  refreshSnapshot,
  snapshotKey,
  type SnapshotCacheState,
} from './snapshotRefresh'
import type { SnapshotResult } from './types'

export type SnapshotStore = {
  load: (key: string) => SnapshotCacheState | undefined | Promise<SnapshotCacheState | undefined>
  save: (state: SnapshotCacheState) => void | Promise<void>
}

export type SnapshotCoordinator = { get: (input: GetSnapshotInput) => Promise<SnapshotResult> }

const isUsableState = (state: SnapshotCacheState | undefined, key: string) =>
  state !== undefined && state.v === 1 && state.key === key

/**
 * Serves snapshots from the store while fresh, otherwise refreshes from DonorDrive and saves.
 * Concurrent calls for the same key share one load, refresh and save. `get` never rejects.
 */
export const createSnapshotCoordinator = (
  store: SnapshotStore,
  deps: UpstreamDeps
): SnapshotCoordinator => {
  const inFlight = new Map<string, Promise<SnapshotResult>>()

  const load = async (input: GetSnapshotInput, key: string): Promise<SnapshotResult> => {
    const stored = await store.load(key)
    const state = stored && isUsableState(stored, key) ? stored : emptySnapshotState(key)

    const fresh = readFreshSnapshot(state, deps.now())
    if (fresh) return fresh

    const { result, state: next } = await refreshSnapshot(input, state, deps)
    await store.save(next)
    return result
  }

  const get = (input: GetSnapshotInput): Promise<SnapshotResult> => {
    const key = snapshotKey(input)
    const pending = inFlight.get(key)
    if (pending) return pending

    const request = (async () => {
      try {
        return await load(input, key)
      } catch {
        return {
          ok: false,
          error: { kind: 'upstream', message: 'Unexpected error while fetching DonorDrive' },
        } satisfies SnapshotResult
      } finally {
        inFlight.delete(key)
      }
    })()

    inFlight.set(key, request)
    return request
  }

  return { get }
}

/** Keeps states in memory, keyed by `state.key` (tests and the no-binding fallback) */
export const createMemorySnapshotStore = (): SnapshotStore => {
  const states = new Map<string, SnapshotCacheState>()
  return {
    load: (key) => states.get(key),
    save: (state) => {
      states.set(state.key, state)
    },
  }
}
