import type { DurableObjectState } from '@cloudflare/workers-types'

import type { SnapshotCoordinator, SnapshotStore } from './snapshotCoordinator'
import { createSnapshotCoordinator } from './snapshotCoordinator'
import { getSnapshotInputSchema } from './snapshotInput'
import type { SnapshotCacheState } from './snapshotRefresh'

type StateRow = { body: string }

const json = (body: unknown, status = 200): Response => Response.json(body, { status })

/**
 * One Durable Object per `host:pid`: the single place that calls DonorDrive for a participant.
 * It keeps the raw upstream parts and ETag in SQLite and serves `GET /?host=&pid=` with a
 * `SnapshotResult`, sharing one refresh across every caller.
 */
export class ParticipantSnapshot {
  private readonly ctx: DurableObjectState
  private readonly coordinator: SnapshotCoordinator

  constructor(ctx: DurableObjectState, _env: unknown) {
    this.ctx = ctx
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS snapshot_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        body TEXT NOT NULL
      )`
    )
    const store: SnapshotStore = {
      load: () => this.loadState(),
      save: (state) => this.saveState(state),
    }
    this.coordinator = createSnapshotCoordinator(store, {
      // Wrapped so the global fetch is never called unbound
      fetch: (input, init) => fetch(input, init),
      now: () => Date.now(),
    })
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname !== '/') return json({ error: 'not_found' }, 404)
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405)

    const parsed = getSnapshotInputSchema.safeParse({
      host: url.searchParams.get('host'),
      pid: url.searchParams.get('pid'),
    })
    if (!parsed.success) {
      return json({ error: 'invalid_input', issues: parsed.error.issues }, 400)
    }

    return json(await this.coordinator.get(parsed.data))
  }

  private loadState(): SnapshotCacheState | undefined {
    const rows = this.ctx.storage.sql
      .exec<StateRow>('SELECT body FROM snapshot_state WHERE id = 1')
      .toArray()
    const row = rows[0]
    if (!row) return undefined
    try {
      return JSON.parse(row.body) as SnapshotCacheState
    } catch {
      return undefined
    }
  }

  private saveState(state: SnapshotCacheState): void {
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO snapshot_state (id, body) VALUES (1, ?)',
      JSON.stringify(state)
    )
  }
}
