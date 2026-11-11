import type { SnapshotError } from '@features/donordrive'

/** A problem the dock shows above its content. */
export type DockAlert =
  /** The dock URL has no participant id */
  | { kind: 'missing_pid' }
  /** The dock URL has no dock key, so marks can't be saved */
  | { kind: 'missing_key' }
  | { kind: 'not_found' }
  /** The channel socket dropped; marks stay readable but can't change */
  | { kind: 'channel_disconnected' }
  | { kind: 'rate_limited'; retryInSec?: number }
  | { kind: 'upstream'; message?: string; retryInSec?: number }
  /** A mark write failed and was rolled back */
  | { kind: 'marks_error'; message: string }

export type DockAlertKind = DockAlert['kind']

/** Alert for a failed snapshot fetch. */
export const snapshotErrorAlert = (error: SnapshotError, retryInSec?: number): DockAlert => {
  switch (error.kind) {
    case 'not_found':
      return { kind: 'not_found' }
    case 'rate_limited':
      return { kind: 'rate_limited', retryInSec: retryInSec ?? error.retryAfterSec }
    case 'schema':
      return {
        kind: 'upstream',
        message: "DonorDrive sent data the dock couldn't read",
        retryInSec,
      }
    case 'upstream':
      return { kind: 'upstream', message: error.message, retryInSec }
  }
}

/** Alerts that make marks read-only. */
export const isMarksBlockingAlert = (alert: DockAlert): boolean =>
  alert.kind === 'missing_key' || alert.kind === 'channel_disconnected'
