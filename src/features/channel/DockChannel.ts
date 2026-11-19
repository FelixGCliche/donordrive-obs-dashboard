import type {
  DurableObjectState,
  WebSocket as WorkerWebSocket,
  WebSocketPair as WorkerWebSocketPair,
} from '@cloudflare/workers-types'
import { z } from 'zod'

import type { ChannelAction, ChannelRole, StoredHashes } from './channelAuth'
import { actionFor, channelRoles, checkAccess } from './channelAuth'
import {
  CHANNEL_CREDENTIAL_HASH_HEADER,
  CHANNEL_CREDENTIALS_PATH,
  CHANNEL_INIT_PATH,
  CHANNEL_ROLE_HEADER,
  CREDENTIAL_ROTATED_CLOSE_CODE,
} from './channelPaths'
import { isChannelSubPath } from './channelStub'
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
type CredentialRow = { role: ChannelRole; hash: string; generation: number }

/** Attached to every accepted socket; a socket whose generation is stale gets no more frames. */
type SocketAttachment = { role: ChannelRole; generation: number }

const markKinds: readonly MarkKind[] = ['read', 'fulfilled']

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/)

const initSchema = z.object({ ownerHash: hashSchema, subscriberHash: hashSchema })

const credentialUpdateSchema = z.object({ role: z.enum(channelRoles), hash: hashSchema })

const CREDENTIAL_ROTATED_REASON = 'credential_rotated'

const json = (body: unknown, status = 200): Response => Response.json(body, { status })

const text = (body: string, status: number): Response => new Response(body, { status })

const unauthorized = (): Response =>
  Response.json(
    { error: 'unauthorized', message: 'Missing or invalid channel credential' },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } }
  )

const forbidden = (): Response =>
  Response.json(
    { error: 'forbidden', message: 'This credential may not perform this action' },
    { status: 403 }
  )

const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

const parseRole = (value: string | null): ChannelRole | null =>
  channelRoles.find((role) => role === value) ?? null

/** Action of a request the DO serves; the internal `/credentials` path is the owner-only `rotate`. */
const objectActionFor = (path: string, method: string): ReturnType<typeof actionFor> => {
  if (path === CHANNEL_CREDENTIALS_PATH) {
    return method.toUpperCase() === 'POST' ? 'rotate' : 'method_not_allowed'
  }
  return isChannelSubPath(path) ? actionFor(path, method) : undefined
}

/**
 * One Durable Object per channel: the credential hashes, an event ring buffer, the dock's marks
 * and a WebSocket hub (Hibernation API) that pushes both to every connected socket. The Worker
 * forwards the claimed role and credential hash; every path but the internal `/init` checks them.
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
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS credentials (
        role TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        generation INTEGER NOT NULL,
        updated_at INTEGER
      )`
    )
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === CHANNEL_INIT_PATH) {
      if (request.method !== 'POST') return text('Method not allowed', 405)
      return this.init(await readJson(request))
    }

    const action = objectActionFor(url.pathname, request.method)
    if (!action) return text('Not found', 404)
    if (action === 'method_not_allowed') return text('Method not allowed', 405)

    const role = parseRole(request.headers.get(CHANNEL_ROLE_HEADER))
    const hash = request.headers.get(CHANNEL_CREDENTIAL_HASH_HEADER)
    const access = checkAccess(this.readHashes(), role, hash, action)
    if (access === 'unauthorized' || !role) return unauthorized()
    if (access === 'forbidden') return forbidden()

    return this.serve(request, url, role, action)
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

  /** Runs an action the caller is allowed to perform. */
  private async serve(
    request: Request,
    url: URL,
    role: ChannelRole,
    action: ChannelAction
  ): Promise<Response> {
    switch (action) {
      case 'subscribe':
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
          return text('Expected a WebSocket upgrade', 426)
        }
        return this.connect(role, url.searchParams.get('since'))
      case 'publish':
        return this.publish(await readJson(request))
      case 'readMarks':
        return json(this.readMarks())
      case 'writeMarks':
        return this.updateMarks(await readJson(request))
      case 'rotate':
        return this.rotate(await readJson(request))
      default:
        return text('Not found', 404)
    }
  }

  /** `/init`: stores both credential hashes of a new channel; 409 when it already has them. */
  private init(body: unknown): Response {
    const parsed = initSchema.safeParse(body)
    if (!parsed.success) return json({ error: 'invalid_init', issues: parsed.error.issues }, 400)

    const hashes: Record<ChannelRole, string> = {
      owner: parsed.data.ownerHash,
      subscriber: parsed.data.subscriberHash,
    }
    const created = this.ctx.storage.transactionSync(() => {
      if (this.readCredentials().length > 0) return false
      const now = Date.now()
      for (const role of channelRoles) {
        this.ctx.storage.sql.exec(
          'INSERT INTO credentials (role, hash, generation, updated_at) VALUES (?, ?, 1, ?)',
          role,
          hashes[role],
          now
        )
      }
      return true
    })
    if (!created) return json({ error: 'channel_exists' }, 409)
    return json({ ok: true }, 201)
  }

  /** `/credentials`: replaces the hash of a role and closes that role's open sockets. */
  private rotate(body: unknown): Response {
    const parsed = credentialUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return json({ error: 'invalid_credential', issues: parsed.error.issues }, 400)
    }

    const { role, hash } = parsed.data
    this.ctx.storage.sql.exec(
      'UPDATE credentials SET hash = ?, generation = generation + 1, updated_at = ? WHERE role = ?',
      hash,
      Date.now(),
      role
    )
    for (const ws of this.ctx.getWebSockets(role)) {
      try {
        ws.close(CREDENTIAL_ROTATED_CLOSE_CODE, CREDENTIAL_ROTATED_REASON)
      } catch {
        // Already closed
      }
    }
    return json({ ok: true, generation: this.readGenerations()[role] })
  }

  private readCredentials(): CredentialRow[] {
    return this.ctx.storage.sql
      .exec<CredentialRow>('SELECT role, hash, generation FROM credentials')
      .toArray()
  }

  private readHashes(): StoredHashes {
    const hashes: StoredHashes = {}
    for (const row of this.readCredentials()) hashes[row.role] = row.hash
    return hashes
  }

  private readGenerations(): Partial<Record<ChannelRole, number>> {
    const generations: Partial<Record<ChannelRole, number>> = {}
    for (const row of this.readCredentials()) generations[row.role] = row.generation
    return generations
  }

  private connect(role: ChannelRole, since: string | null): Response {
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.ctx.acceptWebSocket(server, [role])
    const attachment: SocketAttachment = { role, generation: this.readGenerations()[role] ?? 0 }
    server.serializeAttachment(attachment)

    this.send(server, { kind: 'hello', role })
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

  /** Sends `frame` to every socket whose credential has not been rotated since it connected. */
  private broadcast(frame: ServerFrame): void {
    const generations = this.readGenerations()
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as SocketAttachment | null
      if (!attachment || generations[attachment.role] !== attachment.generation) continue
      this.send(ws, frame)
    }
  }
}
