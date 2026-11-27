import type { AllDonationsFetcher, SnapshotError } from '@features/donordrive'
import { DONORDRIVE_PID_PATTERN, fetchAllDonations, isDonorDriveHost } from '@features/donordrive'

import { actionFor, CHANNEL_ID_PATTERN, readRequestCredential } from './channelAuth'
import type { ChannelEnv } from './channelClient'
import { authorizeChannelCall } from './channelClient'
import type { ForwardedAuth } from './channelStub'
import { fetchChannel } from './channelStub'
import { pendingRedemptionEvents } from './pendingEvents'
import { marksSchema, relayEventDataSchema } from './protocol'

/** Worker-only sub-path: unfulfilled redemptions from DonorDrive (not served by the DO). */
export const PENDING_SUB_PATH = '/pending'

/** Most `incentiveId` filters one `/pending` request may pass. */
export const MAX_PENDING_INCENTIVE_IDS = 10

/** Sub-paths third-party apps on other origins call with fetch. */
const corsSubPaths: ReadonlySet<string> = new Set([PENDING_SUB_PATH, '/marks'])

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization',
} as const

export type ChannelRequestDeps = {
  fetchAllDonations?: AllDonationsFetcher
}

/** Sub-path after the channel ID segment, e.g. `/api/channel/<id>/marks` → `/marks`. */
export const channelSubPath = (pathname: string, channelId: string): string => {
  const marker = `/${channelId}`
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

/** Statuses of a DO marks read passed through as-is instead of becoming a 502. */
const passThroughStatuses: ReadonlySet<number> = new Set([401, 403])

/** Fulfilled donation ids from the DO, or the response to return instead. */
const readFulfilled = async (
  env: ChannelEnv,
  channelId: string,
  auth: ForwardedAuth
): Promise<string[] | Response> => {
  try {
    const response = await fetchChannel(env, channelId, '/marks', undefined, auth)
    if (passThroughStatuses.has(response.status)) return response
    if (!response.ok) return text('Could not read dock marks', 502)
    const marks = marksSchema.safeParse(await response.json())
    return marks.success ? marks.data.fulfilled : text('Could not read dock marks', 502)
  } catch {
    return text('Could not read dock marks', 502)
  }
}

/**
 * `GET /pending?host=&pid=&incentiveId=…`: every redemption not marked fulfilled, oldest first.
 * The marks are read first, so the DO verifies the credential before DonorDrive is called.
 */
const handlePending = async (
  url: URL,
  channelId: string,
  env: ChannelEnv,
  auth: ForwardedAuth,
  fetchAll: AllDonationsFetcher
): Promise<Response> => {
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

  const fulfilled = await readFulfilled(env, channelId, auth)
  if (fulfilled instanceof Response) return fulfilled

  const result = await fetchAll({ host, pid })
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

/** Path and query to forward, without the `token` credential. */
const forwardedPathAndQuery = (subPath: string, url: URL): string => {
  const params = new URLSearchParams(url.search)
  params.delete('token')
  const query = params.toString()
  return query ? `${subPath}?${query}` : subPath
}

/**
 * Checks the channel ID, the action, the credential (`Authorization: Bearer` or `?token=`), the
 * role's permission and the rate limit, then forwards the request (WebSocket upgrade, `/events`,
 * `/marks`) to the channel's DockChannel object, which verifies the credential hash. `/pending`
 * is answered by the Worker. `/pending` and `/marks` allow cross-origin calls, errors included.
 */
export const handleChannelRequest = async (
  request: Request,
  channelId: string,
  env: ChannelEnv,
  deps: ChannelRequestDeps = {}
): Promise<Response> => {
  if (!CHANNEL_ID_PATTERN.test(channelId)) return text('Invalid channel ID', 400)

  const url = new URL(request.url)
  const subPath = channelSubPath(url.pathname, channelId)
  const cors = corsSubPaths.has(subPath)
  const finish = (response: Response): Response => (cors ? withCors(response) : response)

  if (cors && request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const action = actionFor(subPath, request.method)
  if (!action) return text('Not found', 404)
  if (action === 'method_not_allowed') return finish(text('Method not allowed', 405))

  const credential = readRequestCredential(request, url)
  const auth = await authorizeChannelCall(env, channelId, credential, action)
  if (auth instanceof Response) return finish(auth)

  if (subPath === PENDING_SUB_PATH) {
    const fetchAll = deps.fetchAllDonations ?? fetchAllDonations
    return finish(await handlePending(url, channelId, env, auth, fetchAll))
  }

  const pathAndQuery = forwardedPathAndQuery(subPath, url)
  return finish(await fetchChannel(env, channelId, pathAndQuery, request, auth))
}
