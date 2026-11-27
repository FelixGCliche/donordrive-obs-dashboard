// Test double for the DockChannel namespace; imported by tests only.
import type { ChannelRole, StoredHashes } from './channelAuth'
import {
  actionFor,
  checkAccess,
  generateChannelId,
  generateCredential,
  hashCredential,
} from './channelAuth'
import type { ChannelEnv } from './channelClient'
import {
  CHANNEL_CREDENTIAL_HASH_HEADER,
  CHANNEL_CREDENTIALS_PATH,
  CHANNEL_INIT_PATH,
  CHANNEL_ROLE_HEADER,
} from './channelPaths'
import type { RateLimiter } from './channelRateLimit'
import { channelObjectName, isChannelSubPath } from './channelStub'

/** A request as the fake object received it. */
export type ReceivedRequest = {
  objectName: string
  url: URL
  method: string
  headers: Headers
  body: string
}

export const FAKE_MARKS = { version: 2, read: [], fulfilled: ['D1'], baselined: true }

const parseRole = (value: string | null): ChannelRole | null =>
  value === 'owner' || value === 'subscriber' ? value : null

/**
 * In-memory DockChannel namespace: stores credential hashes per object and runs the real
 * `checkAccess` and `actionFor` on the forwarded role and hash headers, as the DO does.
 */
export const createFakeChannels = () => {
  const stores = new Map<string, StoredHashes>()
  const received: ReceivedRequest[] = []
  const options = { initConflicts: 0 }

  const handle = async (objectName: string, request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const body = await request.text()
    received.push({ objectName, url, method: request.method, headers: request.headers, body })

    if (url.pathname === CHANNEL_INIT_PATH) {
      if (options.initConflicts > 0) options.initConflicts -= 1
      else if (!stores.has(objectName)) {
        const { ownerHash, subscriberHash } = JSON.parse(body) as Record<string, string>
        stores.set(objectName, { owner: ownerHash, subscriber: subscriberHash })
        return Response.json({ ok: true }, { status: 201 })
      }
      return Response.json({ error: 'channel_exists' }, { status: 409 })
    }

    const action =
      url.pathname === CHANNEL_CREDENTIALS_PATH
        ? 'rotate'
        : isChannelSubPath(url.pathname)
          ? actionFor(url.pathname, request.method)
          : undefined
    if (!action) return new Response('Not found', { status: 404 })
    if (action === 'method_not_allowed') return new Response('Method not allowed', { status: 405 })

    const access = checkAccess(
      stores.get(objectName) ?? {},
      parseRole(request.headers.get(CHANNEL_ROLE_HEADER)),
      request.headers.get(CHANNEL_CREDENTIAL_HASH_HEADER),
      action
    )
    if (access === 'unauthorized') return Response.json({ error: 'unauthorized' }, { status: 401 })
    if (access === 'forbidden') return Response.json({ error: 'forbidden' }, { status: 403 })

    if (action === 'rotate') {
      const { role, hash } = JSON.parse(body) as { role: ChannelRole; hash: string }
      stores.set(objectName, { ...stores.get(objectName), [role]: hash })
      return Response.json({ ok: true })
    }
    if (action === 'subscribe') return new Response('subscribed')
    if (action === 'publish') return Response.json({ ok: true, duplicate: false })
    return Response.json(FAKE_MARKS)
  }

  const namespace = {
    idFromName: (name: string) => ({ name }),
    get: (id: { name: string }) => ({ fetch: (request: Request) => handle(id.name, request) }),
  }

  const env = (limiters: Partial<Record<keyof ChannelEnv, RateLimiter>> = {}): ChannelEnv =>
    ({ DOCK_CHANNEL: namespace, ...limiters }) as unknown as ChannelEnv

  /** Initializes a channel directly in the store and returns its plaintext credentials. */
  const seed = async (channelId = generateChannelId()) => {
    const ownerKey = generateCredential('owner')
    const subscribeToken = generateCredential('subscriber')
    stores.set(channelObjectName(channelId), {
      owner: await hashCredential(ownerKey),
      subscriber: await hashCredential(subscribeToken),
    })
    return { channelId, ownerKey, subscribeToken }
  }

  return { stores, received, options, env, seed }
}

/** Limiter that records keys and answers with `success`. */
export const fakeLimiter = (success: boolean) => {
  const keys: string[] = []
  const limiter: RateLimiter = {
    limit: async ({ key }) => {
      keys.push(key)
      return { success }
    },
  }
  return { limiter, keys }
}
