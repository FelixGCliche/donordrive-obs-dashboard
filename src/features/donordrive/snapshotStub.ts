import type { DurableObjectNamespace } from '@cloudflare/workers-types'

import type { GetSnapshotInput } from './snapshotInput'
import { snapshotKey } from './snapshotRefresh'
import type { SnapshotResult } from './types'

export type SnapshotEnv = {
  PARTICIPANT_SNAPSHOT?: DurableObjectNamespace
}

/** Placeholder origin for requests to a ParticipantSnapshot object; never leaves the Worker. */
export const SNAPSHOT_ORIGIN = 'https://participant-snapshot.internal'

const unavailable: SnapshotResult = {
  ok: false,
  error: { kind: 'upstream', message: 'Snapshot service unavailable' },
}

const isSnapshotResult = (body: unknown): body is SnapshotResult =>
  typeof body === 'object' &&
  body !== null &&
  'ok' in body &&
  typeof (body as { ok: unknown }).ok === 'boolean'

/** Reads a participant's snapshot through its ParticipantSnapshot object; never rejects. */
export const fetchSnapshotObject = async (
  ns: DurableObjectNamespace,
  input: GetSnapshotInput
): Promise<SnapshotResult> => {
  try {
    const stub = ns.get(ns.idFromName(snapshotKey(input)))
    const query = new URLSearchParams({ host: input.host, pid: input.pid })
    // Worker and DOM Request/Response types differ only nominally
    const response = (await stub.fetch(`${SNAPSHOT_ORIGIN}/?${query}`)) as unknown as Response
    if (!response.ok) return unavailable
    const body: unknown = await response.json()
    return isSnapshotResult(body) ? body : unavailable
  } catch {
    return unavailable
  }
}
