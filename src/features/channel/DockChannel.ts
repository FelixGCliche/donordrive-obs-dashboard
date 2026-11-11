import type {
  DurableObjectState,
  WebSocket as WorkerWebSocket,
  WebSocketPair as WorkerWebSocketPair,
} from '@cloudflare/workers-types'

import { DOCK_KEY_HEADER } from './channelPaths'
import { DEDUPE_LIMIT, REPLAY_LIMIT, selectReplay } from './eventBuffer'
import type { Marks, RelayEvent, ServerFrame } from './protocol'
import { relayEventSchema } from './protocol'

// Runtime global in workerd; not part of the DOM lib this project type-checks against
declare const WebSocketPair: typeof WorkerWebSocketPair

type EventRow = { body: string }

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

  private readMarks(): Marks {
    return { version: 0, read: [], fulfilled: [], baselined: false }
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
