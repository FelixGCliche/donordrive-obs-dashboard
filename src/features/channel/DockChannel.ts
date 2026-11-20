import type {
  DurableObjectNamespace,
  DurableObjectState,
  WebSocket as WorkerWebSocket,
  WebSocketPair as WorkerWebSocketPair,
} from '@cloudflare/workers-types'

import type { GetSnapshotInput, SnapshotEnv } from '@features/donordrive'
import { fetchSnapshotObject, getSnapshotInputSchema } from '@features/donordrive'

import { DOCK_KEY_HEADER } from './channelPaths'
import { DEDUPE_LIMIT, REPLAY_LIMIT, SEEN_LIMIT, selectReplay } from './eventBuffer'
import type { MarkKind, MarksState } from './marksState'
import { applyMarksOp } from './marksState'
import { parseDockRegistration } from './pollerRegistration'
import type { PollerClock } from './pollerSchedule'
import { planAlarm, POLL_INTERVAL_MS } from './pollerSchedule'
import type { Marks, MarksOp, RelayEvent, ServerFrame } from './protocol'
import { marksOpSchema, relayEventSchema } from './protocol'
import { diffSnapshot } from './snapshotEvents'

// Runtime global in workerd; not part of the DOM lib this project type-checks against
declare const WebSocketPair: typeof WorkerWebSocketPair

type EventRow = { body: string }
type MarkRow = { donation_id: string; kind: MarkKind }
type MetaRow = { version: number; baselined: number }
type PollerRow = {
  host: string | null
  pid: string | null
  baselined: number
  last_active_at: number
  last_donation_at: number
}
type SeenRow = { donation_id: string }

const markKinds: readonly MarkKind[] = ['read', 'fulfilled']

const json = (body: unknown, status = 200): Response => Response.json(body, { status })

const text = (body: string, status: number): Response => new Response(body, { status })

const registrationKey = (registration: GetSnapshotInput | undefined): string | undefined =>
  registration ? `${registration.host}:${registration.pid}` : undefined

const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

/**
 * One Durable Object per dock key: an event ring buffer, the dock's marks and a
 * WebSocket hub (Hibernation API) that pushes both to every connected socket.
 *
 * A dock socket (`?role=dock&host=…&pid=…`) registers the participant to poll; other sockets never
 * change it. An alarm then reads that participant's ParticipantSnapshot every POLL_INTERVAL_MS,
 * diffs donation ids against the durable `seen_donations` set and publishes each new donation (and
 * incentive redemption) exactly once. Polling stops after IDLE_AFTER_MS without activity, and all
 * state is wiped after WIPE_AFTER_MS (see `planAlarm`).
 */
export class DockChannel {
  private readonly ctx: DurableObjectState
  private readonly snapshots: DurableObjectNamespace | undefined
  private warnedMissingBinding = false

  constructor(ctx: DurableObjectState, env: Partial<SnapshotEnv> | undefined) {
    this.ctx = ctx
    this.snapshots = env?.PARTICIPANT_SNAPSHOT
    this.initSchema()
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const key = request.headers.get(DOCK_KEY_HEADER) ?? ''
    this.touch()

    if (url.pathname === '/') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return text('Expected a WebSocket upgrade', 426)
      }
      return this.connect(key, url.searchParams)
    }

    // Any use keeps the cleanup alarm scheduled
    await this.ensurePlannedAlarm()

    if (url.pathname === '/events') {
      if (request.method !== 'POST') return text('Method not allowed', 405)
      return this.publish(await readJson(request))
    }

    if (url.pathname === '/marks') {
      if (request.method === 'GET') return json(this.readMarks())
      if (request.method !== 'POST') return text('Method not allowed', 405)
      return this.updateMarks(await readJson(request))
    }

    return text('Not found', 404)
  }

  /** Runs the poller's next step; never throws, so the runtime never retries it. */
  async alarm(): Promise<void> {
    try {
      const plan = planAlarm(this.readClock())
      if (plan.kind === 'wipe') {
        await this.wipe()
        return
      }
      if (plan.kind === 'sleep') {
        await this.ctx.storage.setAlarm(plan.nextAt)
        return
      }

      try {
        await this.poll()
      } catch (error) {
        console.warn('DockChannel: poll failed', error)
      }

      const next = planAlarm(this.readClock())
      // A wipe right after a poll is unreachable in practice; let the next alarm handle it
      await this.ctx.storage.setAlarm(next.kind === 'wipe' ? Date.now() : next.nextAt)
    } catch (error) {
      console.warn('DockChannel: alarm failed', error)
    }
  }

  webSocketMessage(_ws: WorkerWebSocket, _message: string | ArrayBuffer): void {
    // Subscribers only listen; incoming messages are ignored
  }

  webSocketClose(ws: WorkerWebSocket, code: number, reason: string): void {
    this.touch()
    try {
      ws.close(code, reason)
    } catch {
      // Already closed
    }
  }

  webSocketError(ws: WorkerWebSocket): void {
    this.touch()
    try {
      ws.close(1011, 'error')
    } catch {
      // Already closed
    }
  }

  /** Creates every table; runs on construction and again after a wipe. */
  private initSchema(): void {
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        body TEXT NOT NULL
      )`
    )
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS marks (
        donation_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (kind, donation_id)
      )`
    )
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL,
        baselined INTEGER NOT NULL
      )`
    )
    this.ctx.storage.sql.exec(
      'INSERT OR IGNORE INTO meta (id, version, baselined) VALUES (1, 0, 0)'
    )
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS poller (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        host TEXT,
        pid TEXT,
        baselined INTEGER NOT NULL DEFAULT 0,
        last_active_at INTEGER NOT NULL,
        last_donation_at INTEGER NOT NULL DEFAULT 0
      )`
    )
    this.ctx.storage.sql.exec(
      'INSERT OR IGNORE INTO poller (id, last_active_at) VALUES (1, ?)',
      Date.now()
    )
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS seen_donations (
        donation_id TEXT PRIMARY KEY,
        seen_at INTEGER NOT NULL
      )`
    )
  }

  private async connect(key: string, params: URLSearchParams): Promise<Response> {
    const registration = parseDockRegistration(params)
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.ctx.acceptWebSocket(server)

    this.send(server, { kind: 'hello', key })
    this.send(server, {
      kind: 'replay',
      events: selectReplay(this.readEvents(), params.get('since')),
    })
    this.send(server, { kind: 'marks', marks: this.readMarks() })

    // Only a dock socket sets the registration; any other socket just keeps cleanup scheduled
    if (!registration) {
      await this.ensurePlannedAlarm()
    } else if (registrationKey(registration) === registrationKey(this.readRegistration())) {
      await this.ensureAlarm(Date.now() + POLL_INTERVAL_MS)
    } else {
      this.register(registration)
      await this.ensureAlarm(Date.now())
    }

    const init = { status: 101, webSocket: client }
    return new Response(null, init as ResponseInit)
  }

  private publish(body: unknown): Response {
    const parsed = relayEventSchema.safeParse(body)
    if (!parsed.success) {
      return json({ error: 'invalid_event', issues: parsed.error.issues }, 400)
    }

    const event = parsed.data
    if (!this.insertEvent(event)) return json({ ok: true, duplicate: true })
    this.broadcast({ kind: 'event', event })
    return json({ ok: true, duplicate: false })
  }

  /** Stores an event unless its id is already buffered, then trims to DEDUPE_LIMIT. */
  private insertEvent(event: RelayEvent): boolean {
    const seen = this.ctx.storage.sql
      .exec('SELECT 1 FROM events WHERE id = ? LIMIT 1', event.id)
      .toArray()
    if (seen.length > 0) return false

    this.ctx.storage.sql.exec(
      'INSERT INTO events (id, body) VALUES (?, ?)',
      event.id,
      JSON.stringify(event)
    )
    this.ctx.storage.sql.exec(
      'DELETE FROM events WHERE seq NOT IN (SELECT seq FROM events ORDER BY seq DESC LIMIT ?)',
      DEDUPE_LIMIT
    )
    return true
  }

  /**
   * Reads the registered participant's snapshot and publishes its new donations. Everything after
   * the single await runs synchronously in one transaction, so each donation publishes once.
   */
  private async poll(): Promise<void> {
    if (!this.snapshots) {
      if (!this.warnedMissingBinding) {
        console.warn('DockChannel: PARTICIPANT_SNAPSHOT binding missing; polling disabled')
        this.warnedMissingBinding = true
      }
      return
    }

    const registration = this.readRegistration()
    if (!registration) return
    const polledKey = registrationKey(registration)

    const result = await fetchSnapshotObject(this.snapshots, registration)
    // A snapshot error skips this tick; the schedule carries on
    if (!result.ok) return

    const inserted = this.ctx.storage.transactionSync((): RelayEvent[] => {
      // A dock may have registered another participant while the snapshot loaded
      if (registrationKey(this.readRegistration()) !== polledKey) return []

      const now = Date.now()
      const baseline = this.readPoller().baselined === 0
      const seen = new Set(
        this.ctx.storage.sql
          .exec<SeenRow>('SELECT donation_id FROM seen_donations')
          .toArray()
          .map((row) => row.donation_id)
      )
      const { seenIds, events } = diffSnapshot(result.snapshot, seen, baseline, now)

      for (const id of seenIds) {
        this.ctx.storage.sql.exec(
          'INSERT OR IGNORE INTO seen_donations (donation_id, seen_at) VALUES (?, ?)',
          id,
          now
        )
      }
      this.ctx.storage.sql.exec(
        `DELETE FROM seen_donations WHERE rowid NOT IN
          (SELECT rowid FROM seen_donations ORDER BY rowid DESC LIMIT ?)`,
        SEEN_LIMIT
      )
      this.ctx.storage.sql.exec('UPDATE poller SET baselined = 1 WHERE id = 1')
      if (!baseline && seenIds.length > 0) {
        this.ctx.storage.sql.exec('UPDATE poller SET last_donation_at = ? WHERE id = 1', now)
      }

      return events.filter((event) => this.insertEvent(event))
    })

    for (const event of inserted) this.broadcast({ kind: 'event', event })
  }

  /** Stores a new participant to poll; its next poll is a baseline again. */
  private register(registration: GetSnapshotInput): void {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        'UPDATE poller SET host = ?, pid = ?, baselined = 0 WHERE id = 1',
        registration.host,
        registration.pid
      )
      this.ctx.storage.sql.exec('DELETE FROM seen_donations')
    })
  }

  private readPoller(): PollerRow {
    return this.ctx.storage.sql
      .exec<PollerRow>(
        'SELECT host, pid, baselined, last_active_at, last_donation_at FROM poller WHERE id = 1'
      )
      .one()
  }

  /** The registered participant, or undefined when no dock registered a valid one. */
  private readRegistration(): GetSnapshotInput | undefined {
    const { host, pid } = this.readPoller()
    const parsed = getSnapshotInputSchema.safeParse({ host, pid })
    return parsed.success ? { host: parsed.data.host, pid: parsed.data.pid } : undefined
  }

  /** The poller's clock; open sockets count as activity right now and are persisted as such. */
  private readClock(): PollerClock {
    const hasSockets = this.ctx.getWebSockets().length > 0
    if (hasSockets) this.touch()
    const poller = this.readPoller()
    return {
      now: Date.now(),
      registered: this.readRegistration() !== undefined,
      hasSockets,
      lastActiveAt: poller.last_active_at,
      lastDonationAt: poller.last_donation_at,
    }
  }

  private touch(): void {
    this.ctx.storage.sql.exec('UPDATE poller SET last_active_at = ? WHERE id = 1', Date.now())
  }

  /** Sets the alarm to `at` unless one is already due sooner. */
  private async ensureAlarm(at: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm()
    if (current === null || current > at) await this.ctx.storage.setAlarm(at)
  }

  /** Ensures an alarm at whatever the schedule plans next, so cleanup always runs. */
  private async ensurePlannedAlarm(): Promise<void> {
    const plan = planAlarm(this.readClock())
    await this.ensureAlarm(plan.kind === 'wipe' ? Date.now() : plan.nextAt)
  }

  /** Drops every trace of this key, then recreates the empty tables. */
  private async wipe(): Promise<void> {
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
    this.initSchema()
  }

  /** Newest replay window, oldest first. */
  private readEvents(): RelayEvent[] {
    const rows = this.ctx.storage.sql
      .exec<EventRow>('SELECT body FROM events ORDER BY seq DESC LIMIT ?', REPLAY_LIMIT)
      .toArray()
    return rows.reverse().map((row) => JSON.parse(row.body) as RelayEvent)
  }

  private updateMarks(body: unknown): Response {
    const parsed = marksOpSchema.safeParse(body)
    if (!parsed.success) {
      return json({ error: 'invalid_marks_op', issues: parsed.error.issues }, 400)
    }

    const { marks, changed } = this.ctx.storage.transactionSync(() => this.applyOp(parsed.data))
    if (changed) this.broadcast({ kind: 'marks', marks })
    return json(marks)
  }

  /** Runs inside a transaction: applies the op, persists the difference and bumps the version. */
  private applyOp(op: MarksOp): { marks: Marks; changed: boolean } {
    const current = this.readMarks()
    // MVP-SHORTCUT(MVP-09): `baseline` marks every donation present on first use as read, once per key
    const { state, changed } = applyMarksOp(current, op)
    if (!changed) return { marks: current, changed }

    const now = Date.now()
    for (const kind of markKinds) {
      const before = new Set(current[kind])
      const after = new Set(state[kind])
      for (const id of before) {
        if (after.has(id)) continue
        this.ctx.storage.sql.exec('DELETE FROM marks WHERE kind = ? AND donation_id = ?', kind, id)
      }
      for (const id of state[kind]) {
        if (before.has(id)) continue
        this.ctx.storage.sql.exec(
          'INSERT INTO marks (donation_id, kind, at) VALUES (?, ?, ?)',
          id,
          kind,
          now
        )
      }
    }

    const version = current.version + 1
    this.ctx.storage.sql.exec(
      'UPDATE meta SET version = ?, baselined = ? WHERE id = 1',
      version,
      state.baselined ? 1 : 0
    )
    return { marks: { ...state, version }, changed }
  }

  /** Current marks; each list is ordered oldest first. */
  private readMarks(): Marks {
    const meta = this.ctx.storage.sql
      .exec<MetaRow>('SELECT version, baselined FROM meta WHERE id = 1')
      .one()
    const state: MarksState = { read: [], fulfilled: [], baselined: meta.baselined === 1 }
    const rows = this.ctx.storage.sql.exec<MarkRow>(
      'SELECT donation_id, kind FROM marks ORDER BY at, rowid'
    )
    for (const row of rows) state[row.kind].push(row.donation_id)
    return { version: meta.version, ...state }
  }

  private send(ws: WorkerWebSocket, frame: ServerFrame): void {
    try {
      ws.send(JSON.stringify(frame))
    } catch {
      // Socket is closing; it will be dropped by the runtime
    }
  }

  private broadcast(frame: ServerFrame): void {
    for (const ws of this.ctx.getWebSockets()) this.send(ws, frame)
  }
}
