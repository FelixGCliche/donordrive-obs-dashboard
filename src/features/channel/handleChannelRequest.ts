import type { AllDonationsFetcher, SnapshotError } from '@features/donordrive'
import { DONORDRIVE_PID_PATTERN, fetchAllDonations, isDonorDriveHost } from '@features/donordrive'

import type { ChannelEnv } from './channelClient'
import { fetchChannel, isChannelSubPath } from './channelStub'
import { pendingRedemptionEvents } from './pendingEvents'
import { DOCK_KEY_PATTERN, marksSchema, relayEventDataSchema } from './protocol'

/** Worker-only sub-path: unfulfilled redemptions from DonorDrive (not served by the DO). */
export const PENDING_SUB_PATH = '/pending'

/** Most `incentiveId` filters one `/pending` request may pass. */
export const MAX_PENDING_INCENTIVE_IDS = 10

/** Sub-paths third-party apps on other origins call with fetch. */
const corsSubPaths: ReadonlySet<string> = new Set([PENDING_SUB_PATH, '/marks'])

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
} as const

export type ChannelRequestDeps = {
  fetchAllDonations?: AllDonationsFetcher
}

/** Sub-path after the key segment of `pathname`, e.g. `/api/channel/<key>/marks` → `/marks`. */
export const channelSubPath = (pathname: string, key: string): string => {
  const marker = `/${key}`
  const at = pathname.indexOf(marker)
  const rest = at === -1 ? '' : pathname.slice(at + marker.length)
  const trimmed = rest.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

/** Copies the response (forwarded DO responses have immutable headers) and adds CORS headers. */
const withCors = (response: Response): Response => {
  const copy = new Response(response.body, response)
  for (const [name, value] of Object.entries(CORS_HEADERS)) copy.headers.set(name, value)
  return copy
}

const text = (body: string, status: number, headers?: HeadersInit): Response =>
  new Response(body, { status, headers })

const incentiveIdSchema = relayEventDataSchema.shape.donationId

const statusFor = (error: SnapshotError): number => {
  if (error.kind === 'not_found') return 404
  if (error.kind === 'rate_limited') return 429
  return 502
}

const upstreamFailure = (error: SnapshotError): Response => {
  const headers: Record<string, string> = {}
  if (error.kind === 'rate_limited' && error.retryAfterSec !== undefined) {
    headers['Retry-After'] = String(error.retryAfterSec)
  }
  return Response.json(
    { error: error.kind, message: error.message },
    { status: statusFor(error), headers }
  )
}

const readFulfilled = async (env: ChannelEnv, key: string): Promise<string[] | undefined> => {
  try {
    const response = await fetchChannel(env, key, '/marks')
    if (!response.ok) return undefined
    const marks = marksSchema.safeParse(await response.json())
    return marks.success ? marks.data.fulfilled : undefined
  } catch {
    return undefined
  }
}

/** `GET /pending?host=&pid=&incentiveId=…`: every redemption not marked fulfilled, oldest first. */
const handlePending = async (
  request: Request,
  url: URL,
  key: string,
  env: ChannelEnv,
  fetchAll: AllDonationsFetcher
): Promise<Response> => {
  if (request.method !== 'GET') return text('Method not allowed', 405, { Allow: 'GET, OPTIONS' })

  const host = url.searchParams.get('host')
  const pid = url.searchParams.get('pid')
  const incentiveIds = url.searchParams.getAll('incentiveId')
  if (!isDonorDriveHost(host)) return text('Invalid host', 400)
  if (!pid || !DONORDRIVE_PID_PATTERN.test(pid)) return text('Invalid pid', 400)
  if (
    incentiveIds.length > MAX_PENDING_INCENTIVE_IDS ||
    incentiveIds.some((id) => !incentiveIdSchema.safeParse(id).success)
  ) {
    return text('Invalid incentiveId', 400)
  }

  const [fulfilled, result] = await Promise.all([readFulfilled(env, key), fetchAll({ host, pid })])
  if (!fulfilled) return text('Could not read dock marks', 502)
  if (!result.ok) return upstreamFailure(result.error)

  const events = pendingRedemptionEvents({
    donations: result.donations,
    incentives: result.incentives,
    fulfilled,
    participantId: result.participantId,
    incentiveIds: incentiveIds.length > 0 ? incentiveIds : undefined,
  })
  return Response.json({ events }, { headers: { 'Cache-Control': 'no-store' } })
}

/**
 * Validates the dock key and forwards the request (WebSocket upgrade, `/events`, `/marks`)
 * to the DockChannel Durable Object named after it. `/pending` is answered by the Worker.
 * `/pending` and `/marks` allow cross-origin calls.
 */
export const handleChannelRequest = async (
  request: Request,
  key: string,
  env: ChannelEnv,
  deps: ChannelRequestDeps = {}
): Promise<Response> => {
  // MVP-SHORTCUT(MVP-05): the dock key is the only auth for subscribing, publishing and marks; no rate limit
  if (!DOCK_KEY_PATTERN.test(key)) return text('Invalid dock key', 400)

  const url = new URL(request.url)
  const subPath = channelSubPath(url.pathname, key)
  const cors = corsSubPaths.has(subPath)

  if (cors && request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (subPath === PENDING_SUB_PATH) {
    const response = await handlePending(
      request,
      url,
      key,
      env,
      deps.fetchAllDonations ?? fetchAllDonations
    )
    return withCors(response)
  }
  if (!isChannelSubPath(subPath)) return text('Not found', 404)

  const response = await fetchChannel(env, key, `${subPath}${url.search}`, request)
  return cors ? withCors(response) : response
}
