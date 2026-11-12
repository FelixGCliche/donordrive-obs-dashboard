import type {
  DurableObjectState,
  WebSocket as WorkerWebSocket,
  WebSocketPair as WorkerWebSocketPair,
} from '@cloudflare/workers-types'

import { DOCK_KEY_HEADER } from './channelPaths'
import { DEDUPE_LIMIT, REPLAY_LIMIT, selectReplay } from './eventBuffer'
import type { MarkKind, MarksState } from './marksState'
import { applyMarksOp } from './marksState'
import type { Marks, MarksOp, RelayEvent, ServerFrame } from './protocol'
import { marksOpSchema, relayEventSchema } from './protocol'

// Runtime global in workerd; not part of the DOM lib this project type-checks against
declare const WebSocketPair: typeof WorkerWebSocketPair

type EventRow = { body: string }
type MarkRow = { donation_id: string; kind: MarkKind }
type MetaRow = { version: number; baselined: number }

const markKinds: readonly MarkKind[] = ['read', 'fulfilled']

const json = (body: unknown, status = 200): Response => Response.json(body, { status })

const text = (body: string, status: number): Response => new Response(body, { status })

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
 */
export class DockChannel {
  private readonly ctx: DurableObjectState

  constructor(ctx: DurableObjectState, _env: unknown) {
    this.ctx = ctx
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
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const key = request.headers.get(DOCK_KEY_HEADER) ?? ''

    if (url.pathname === '/') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return text('Expected a WebSocket upgrade', 426)
      }
      return this.connect(key, url.searchParams.get('since'))
    }

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

  webSocketMessage(_ws: WorkerWebSocket, _message: string | ArrayBuffer): void {
    // Subscribers only listen; incoming messages are ignored
  }

  webSocketClose(ws: WorkerWebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason)
    } catch {
      // Already closed
    }
  }

  webSocketError(ws: WorkerWebSocket): void {
    try {
      ws.close(1011, 'error')
    } catch {
      // Already closed
    }
  }

  private connect(key: string, since: string | null): Response {
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.ctx.acceptWebSocket(server)

    this.send(server, { kind: 'hello', key })
    this.send(server, { kind: 'replay', events: selectReplay(this.readEvents(), since) })
    this.send(server, { kind: 'marks', marks: this.readMarks() })

    const init = { status: 101, webSocket: client }
    return new Response(null, init as ResponseInit)
  }

  private publish(body: unknown): Response {
    const parsed = relayEventSchema.safeParse(body)
    if (!parsed.success) {
      return json({ error: 'invalid_event', issues: parsed.error.issues }, 400)
    }

    const event = parsed.data
    const seen = this.ctx.storage.sql
      .exec('SELECT 1 FROM events WHERE id = ? LIMIT 1', event.id)
      .toArray()
    if (seen.length > 0) return json({ ok: true, duplicate: true })

    this.ctx.storage.sql.exec(
      'INSERT INTO events (id, body) VALUES (?, ?)',
      event.id,
      JSON.stringify(event)
    )

    this.ctx.storage.sql.exec(
      'DELETE FROM events WHERE seq NOT IN (SELECT seq FROM events ORDER BY seq DESC LIMIT ?)',
      DEDUPE_LIMIT
    )
    this.broadcast({ kind: 'event', event })
    return json({ ok: true, duplicate: false })
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
