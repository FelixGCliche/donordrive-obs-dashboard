import { createElement, useCallback, useMemo, useState } from 'react'
import { z } from 'zod'

import { useChannel, usePublishEvents } from '@features/channel'
import { getSnapshotRefetchInterval, useSnapshotQuery } from '@features/donordrive'
import type { DonorDriveHost, SnapshotError } from '@features/donordrive'
import { useMarks } from '@features/marks'
import { SandboxPanel, useSandbox, withFallbackIncentives } from '@features/sandbox'
import { useLocalStorage, useNow } from '@hooks'

import type { DockProps } from './Dock'
import { snapshotErrorAlert } from './dockAlert'
import type { DockAlert } from './dockAlert'
import type { DockSearch } from './dockSearch'
import { selectDashboard } from './selectDashboard'
import type { DockStatus } from './StatusBadge'

const pausedSchema = z.boolean()
const NOT_PAUSED = false

/** localStorage key of a dock's paused state. */
export const pausedStorageKey = (host: DonorDriveHost, pid: string) =>
  `ddobs:v1:${host}:${pid}:paused`

/** How often time-based model fields (incentive start and end) are re-evaluated. */
const MODEL_CLOCK_MS = 15_000

/** Error of a poll that threw instead of returning a result (our server unreachable). */
const THROWN_ERROR: SnapshotError = { kind: 'upstream', message: 'Could not reach the server' }

const byNewest = (a: { createdAt: string }, b: { createdAt: string }) =>
  (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)

/**
 * Wires the dock: polls the snapshot, syncs marks over one channel socket, merges the sandbox
 * and publishes new donations as relay events. Returns everything `<Dock>` renders.
 */
export const useDashboard = ({
  pid,
  host,
  interval,
  theme,
  density,
  key,
}: DockSearch): DockProps => {
  const [paused, setPaused] = useLocalStorage(
    pausedStorageKey(host, pid ?? ''),
    pausedSchema,
    NOT_PAUSED
  )
  const [isSandboxOpen, setSandboxOpen] = useState(false)
  const now = useNow()

  const query = useSnapshotQuery({ host, pid, interval, paused })
  // Placeholder data belongs to another host or pid
  const data = query.isPlaceholderData ? undefined : query.data
  const snapshot = data?.snapshot

  const sandbox = useSandbox({ host, pid })
  const channel = useChannel({ key })

  // Until the first snapshot, no ids: a baseline must cover the real donations, not only test ones
  const donationIds = useMemo(
    () =>
      snapshot
        ? [...snapshot.donations, ...sandbox.donations]
            .sort(byNewest)
            .map((donation) => donation.id)
        : [],
    [snapshot, sandbox.donations]
  )
  const marks = useMarks({ key, donationIds, channel })

  const liveIncentives = snapshot?.incentives
  const panelIncentives = useMemo(
    () => withFallbackIncentives(liveIncentives ?? []),
    [liveIncentives]
  )

  // Fallback test incentives join the model only once a test donation redeems one
  const sandboxIncentives = useMemo(() => {
    const redeemed = new Set(sandbox.donations.map((donation) => donation.incentiveId))
    const fallbacks = panelIncentives.filter(
      (incentive) => incentive.isTest && redeemed.has(incentive.id)
    )
    return [...sandbox.incentives, ...fallbacks]
  }, [panelIncentives, sandbox.donations, sandbox.incentives])

  const clockTick = Math.floor(now.getTime() / MODEL_CLOCK_MS)
  const { isRead, isFulfilled } = marks
  // Before marks load (or without a key) everything reads as read, so nothing flashes unread
  const hasMarks = marks.marks !== undefined
  const model = useMemo(
    () =>
      snapshot &&
      selectDashboard({
        snapshot,
        sandbox: { donations: sandbox.donations, incentives: sandboxIncentives },
        marks: hasMarks ? { isRead, isFulfilled } : undefined,
        now: clockTick * MODEL_CLOCK_MS,
      }),
    [snapshot, sandbox.donations, sandboxIncentives, hasMarks, isRead, isFulfilled, clockTick]
  )

  usePublishEvents({ key, model })

  // The disconnected alert waits for a first successful connect
  const [connectedKey, setConnectedKey] = useState<string>()
  // Adjusting state during render (React's documented pattern) instead of in an effect
  if (channel.status === 'open' && connectedKey !== key) setConnectedKey(key)
  const hasConnected = key !== undefined && connectedKey === key

  const thrown = query.status === 'error'
  const pollError: SnapshotError | undefined = thrown ? THROWN_ERROR : data?.error
  const errorStreak = thrown ? query.failureCount : (data?.errorStreak ?? 0)
  const lastPollAt = thrown ? query.errorUpdatedAt : query.dataUpdatedAt

  const nextPollMs = pollError
    ? getSnapshotRefetchInterval({
        intervalSec: interval,
        paused,
        lastError: pollError,
        errorStreak,
      })
    : false
  const retryInSec =
    nextPollMs === false ? undefined : Math.max(0, (lastPollAt + nextPollMs - now.getTime()) / 1000)

  const status: DockStatus = (() => {
    if (paused) return 'paused'
    if (!pid) return 'offline'
    if (!pollError) return 'live'
    if (pollError.kind === 'not_found') return 'error'
    if (snapshot) return 'retrying'
    return thrown ? 'offline' : 'error'
  })()

  const alerts: DockAlert[] = []
  if (!pid) alerts.push({ kind: 'missing_pid' })
  else if (!key) alerts.push({ kind: 'missing_key' })
  if (pid && pollError && (pollError.kind === 'not_found' || !paused)) {
    alerts.push(snapshotErrorAlert(pollError, retryInSec))
  }
  if (key && hasConnected && channel.status !== 'open')
    alerts.push({ kind: 'channel_disconnected' })
  if (marks.error) alerts.push({ kind: 'marks_error', message: marks.error })

  const { refetch } = query
  const onRefresh = useCallback(() => {
    if (pid) void refetch()
  }, [pid, refetch])

  const onTogglePause = useCallback(() => setPaused((previous) => !previous), [setPaused])
  const onToggleSandbox = useCallback(() => setSandboxOpen((open) => !open), [])

  const { toggleRead, markAllRead, setFulfilled } = marks
  const onToggleRead = useCallback(
    (donationId: string, nextIsRead: boolean) => {
      if (isRead(donationId) !== nextIsRead) toggleRead(donationId)
    },
    [isRead, toggleRead]
  )
  const onMarkFulfilled = useCallback(
    (donationId: string) => setFulfilled(donationId, true),
    [setFulfilled]
  )

  const { addDonation, addRandom, clear } = sandbox
  const onRandom = useCallback(() => addRandom(panelIncentives), [addRandom, panelIncentives])
  const sandboxSlot = createElement(SandboxPanel, {
    incentives: panelIncentives,
    donationCount: sandbox.donations.length,
    onAdd: addDonation,
    onRandom,
    onClear: clear,
    disabled: !pid,
  })

  return {
    model,
    status,
    alerts,
    search: { theme, density, interval },
    isPaused: paused,
    isRefreshing: query.isFetching,
    isSandboxOpen,
    sandboxSlot,
    isMarksReadOnly: !marks.canWrite,
    onTogglePause,
    onRefresh,
    onToggleSandbox,
    onToggleRead,
    onMarkAllRead: markAllRead,
    onMarkFulfilled,
  }
}
