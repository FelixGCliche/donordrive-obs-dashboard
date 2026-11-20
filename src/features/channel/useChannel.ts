import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'

import type { DonorDriveHost } from '@features/donordrive'

import {
  acquireChannel,
  readChannelStatus,
  subscribeChannel,
  watchChannelStatus,
} from './channelSocket'
import type { ServerFrame } from './protocol'

export type ChannelStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

export type ChannelFrameListener = (frame: ServerFrame) => void

export type UseChannelResult = {
  status: ChannelStatus
  /** Returns an unsubscribe function */
  subscribe: (listener: ChannelFrameListener) => () => void
}

/** Participant a dock registers on connect, so the server polls its donations. */
export type ChannelParticipant = { host: DonorDriveHost; pid: string }

export type UseChannelOptions = {
  /** Dock key; no socket is opened while it is undefined */
  key: string | undefined
  /** Set by the dock only; consumers never register a participant */
  participant?: ChannelParticipant
}

const noop = () => {}

/** Opens one WebSocket to the dock channel and exposes its status and frames. */
export const useChannel = ({ key, participant }: UseChannelOptions): UseChannelResult => {
  const watchStatus = useCallback(
    (listener: () => void) => (key ? watchChannelStatus(key, listener) : noop),
    [key]
  )
  const getStatus = useCallback((): ChannelStatus => (key ? readChannelStatus(key) : 'idle'), [key])
  const getServerStatus = useCallback((): ChannelStatus => (key ? 'connecting' : 'idle'), [key])
  const status = useSyncExternalStore(watchStatus, getStatus, getServerStatus)

  // The socket is opened in an effect only, so nothing touches `window` during render or SSR
  // Keyed on host and pid, not the object, so a new object per render does not reconnect
  const host = participant?.host
  const pid = participant?.pid
  useEffect(
    () => (key ? acquireChannel(key, host && pid ? { host, pid } : undefined) : undefined),
    [key, host, pid]
  )

  const subscribe = useCallback(
    (listener: ChannelFrameListener) => (key ? subscribeChannel(key, listener) : noop),
    [key]
  )

  return useMemo(() => ({ status, subscribe }), [status, subscribe])
}
