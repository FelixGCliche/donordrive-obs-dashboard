import { describe, expect, mock, test } from 'bun:test'

import { SNAPSHOT_FRESH_MS, type UpstreamDeps } from './donorDriveFetch'
import {
  createMemorySnapshotStore,
  createSnapshotCoordinator,
  type SnapshotStore,
} from './snapshotCoordinator'
import {
  rawDonationsFixture,
  rawIncentivesFixture,
  rawParticipantFixture,
} from './snapshotFixtures'
import type { GetSnapshotInput } from './snapshotInput'
import type { SnapshotCacheState } from './snapshotRefresh'

const START = Date.parse('2026-11-11T12:00:00.000Z')
const INPUT: GetSnapshotInput = { host: 'extralife', pid: '500001' }
const KEY = 'extralife:500001'

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', ETag: 'W/"v1"' },
  })

const setup = (options: { gate?: Promise<void> } = {}) => {
  let clock = START
  const fetch = mock(async (input: string, _init?: RequestInit) => {
    await options.gate
    const url = new URL(input)
    if (url.pathname.endsWith('/donations')) return json(rawDonationsFixture)
    if (url.pathname.endsWith('/incentives')) return json(rawIncentivesFixture)
    return json(rawParticipantFixture)
  })
  const deps: UpstreamDeps = { fetch, now: () => clock }
  return {
    fetch,
    deps,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

describe('createSnapshotCoordinator', () => {
  test('concurrent calls share one load, refresh and save', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const t = setup({ gate })
    const memory = createMemorySnapshotStore()
    const store: SnapshotStore = { load: mock(memory.load), save: mock(memory.save) }
    const coordinator = createSnapshotCoordinator(store, t.deps)

    const pending = Array.from({ length: 5 }, () => coordinator.get(INPUT))
    release()
    const results = await Promise.all(pending)

    expect(t.fetch).toHaveBeenCalledTimes(3)
    expect(store.load).toHaveBeenCalledTimes(1)
    expect(store.save).toHaveBeenCalledTimes(1)
    expect(results.every((r) => r === results[0])).toBe(true)
    expect(results[0].ok).toBe(true)
  })

  test('keys are independent', async () => {
    const t = setup()
    const coordinator = createSnapshotCoordinator(createMemorySnapshotStore(), t.deps)
    await Promise.all([coordinator.get(INPUT), coordinator.get({ host: 'try', pid: '500001' })])
    expect(t.fetch).toHaveBeenCalledTimes(6)
  })

  test('saves the refreshed state', async () => {
    const t = setup()
    const store = createMemorySnapshotStore()
    const coordinator = createSnapshotCoordinator(store, t.deps)
    const result = await coordinator.get(INPUT)

    const saved = (await store.load(KEY)) as SnapshotCacheState
    expect(saved.v).toBe(1)
    expect(saved.key).toBe(KEY)
    expect(saved.etag).toBe('W/"v1"')
    expect(saved.checkedAt).toBe(START)
    expect(saved.result).toEqual(result)
  })

  test('a fresh stored result is served without fetching or saving', async () => {
    const t = setup()
    const memory = createMemorySnapshotStore()
    const store: SnapshotStore = { load: memory.load, save: mock(memory.save) }
    const coordinator = createSnapshotCoordinator(store, t.deps)

    const first = await coordinator.get(INPUT)
    t.advance(SNAPSHOT_FRESH_MS - 1)
    const second = await coordinator.get(INPUT)

    expect(t.fetch).toHaveBeenCalledTimes(3)
    expect(store.save).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)

    t.advance(2)
    await coordinator.get(INPUT)
    expect(t.fetch).toHaveBeenCalledTimes(4)
    expect(store.save).toHaveBeenCalledTimes(2)
  })

  test('a stored state with a mismatched key or version is reset', async () => {
    const t = setup()
    const stale: SnapshotCacheState = {
      v: 1,
      key: 'try:500001',
      checkedAt: START,
      etag: 'W/"v1"',
      result: { ok: false, error: { kind: 'not_found', message: 'Participant not found' } },
    }
    const saved: SnapshotCacheState[] = []
    const coordinator = createSnapshotCoordinator(
      { load: () => stale, save: (state) => void saved.push(state) },
      t.deps
    )

    const result = await coordinator.get(INPUT)
    expect(result.ok).toBe(true)
    // A reset state has no ETag, so no If-None-Match and a full fetch
    expect(t.fetch).toHaveBeenCalledTimes(3)
    expect(new Headers(t.fetch.mock.calls[0][1]?.headers).get('If-None-Match')).toBeNull()
    expect(saved[0].key).toBe(KEY)

    const wrongVersion = { ...stale, key: KEY, v: 2 } as unknown as SnapshotCacheState
    const coordinator2 = createSnapshotCoordinator(
      { load: () => wrongVersion, save: () => {} },
      t.deps
    )
    expect((await coordinator2.get(INPUT)).ok).toBe(true)
  })

  test('a failing store resolves an upstream error and clears the in-flight entry', async () => {
    const t = setup()
    const memory = createMemorySnapshotStore()
    let failLoad = true
    const store: SnapshotStore = {
      load: async (key) => {
        if (failLoad) throw new Error('storage down')
        return memory.load(key)
      },
      save: memory.save,
    }
    const coordinator = createSnapshotCoordinator(store, t.deps)

    expect(await coordinator.get(INPUT)).toEqual({
      ok: false,
      error: { kind: 'upstream', message: 'Unexpected error while fetching DonorDrive' },
    })
    expect(t.fetch).toHaveBeenCalledTimes(0)

    failLoad = false
    const result = await coordinator.get(INPUT)
    expect(result.ok).toBe(true)
    expect(t.fetch).toHaveBeenCalledTimes(3)
  })

  test('a failing save still resolves', async () => {
    const t = setup()
    const coordinator = createSnapshotCoordinator(
      {
        load: () => undefined,
        save: () => {
          throw new Error('storage down')
        },
      },
      t.deps
    )
    const result = await coordinator.get(INPUT)
    expect(!result.ok && result.error.kind).toBe('upstream')
  })
})
