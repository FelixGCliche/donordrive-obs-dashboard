/** How often the poller re-reads the snapshot; matches SNAPSHOT_FRESH_MS in donordrive. */
export const POLL_INTERVAL_MS = 15_000
/** Polling stops once the channel has been untouched this long. */
export const IDLE_AFTER_MS = 24 * 60 * 60 * 1000
/** Channel state is wiped once it has been untouched this long. */
export const WIPE_AFTER_MS = 30 * 24 * 60 * 60 * 1000

export type PollerClock = {
  now: number
  /** Whether a dock registered a participant to poll */
  registered: boolean
  /** Whether any socket is connected right now */
  hasSockets: boolean
  lastActiveAt: number
  lastDonationAt: number
}

export type AlarmPlan =
  | { kind: 'poll'; nextAt: number }
  | { kind: 'sleep'; nextAt: number }
  | { kind: 'wipe' }

/** Decides what the poller's alarm does next. */
export const planAlarm = ({
  now,
  registered,
  hasSockets,
  lastActiveAt,
  lastDonationAt,
}: PollerClock): AlarmPlan => {
  // A connected socket counts as activity right now
  const lastTouch = hasSockets ? now : Math.max(lastActiveAt, lastDonationAt)
  const idleFor = now - lastTouch
  if (idleFor >= WIPE_AFTER_MS) return { kind: 'wipe' }
  if (registered && idleFor < IDLE_AFTER_MS) return { kind: 'poll', nextAt: now + POLL_INTERVAL_MS }
  return { kind: 'sleep', nextAt: lastTouch + WIPE_AFTER_MS }
}
