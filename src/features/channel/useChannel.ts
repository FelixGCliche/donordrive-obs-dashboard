import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'

import type { ChannelAuth } from './channelAuth'
import {
  acquireChannel,
  readChannelStatus,
  subscribeChannel,
  watchChannelStatus,
} from './channelSocket'
import type { ServerFrame } from './protocol'

export type ChannelStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'unauthorized'
  | 'closed'

export type ChannelFrameListener = (frame: ServerFrame) => void

export type UseChannelResult = {
  status: ChannelStatus
  /** Returns an unsubscribe function */
  subscribe: (listener: ChannelFrameListener) => () => void
}

export type UseChannelOptions = {
  /** Channel and credential; no socket is opened while it is undefined */
  auth: ChannelAuth | undefined
}

const noop = () => {}

/** Opens one WebSocket to the dock channel and exposes its status and frames. */
export const useChannel = ({ auth }: UseChannelOptions): UseChannelResult => {
  const channelId = auth?.channelId
  const credential = auth?.credential
  // Stable for equal values, so a caller may pass a fresh object every render
  const stableAuth = useMemo<ChannelAuth | undefined>(
    () => (channelId && credential ? { channelId, credential } : undefined),
    [channelId, credential]
  )

  const watchStatus = useCallback(
    (listener: () => void) => (stableAuth ? watchChannelStatus(stableAuth, listener) : noop),
    [stableAuth]
  )
  const getStatus = useCallback(
    (): ChannelStatus => (stableAuth ? readChannelStatus(stableAuth) : 'idle'),
    [stableAuth]
  )
  const getServerStatus = useCallback(
    (): ChannelStatus => (stableAuth ? 'connecting' : 'idle'),
    [stableAuth]
  )
  const status = useSyncExternalStore(watchStatus, getStatus, getServerStatus)

  // The socket is opened in an effect only, so nothing touches `window` during render or SSR
  useEffect(() => (stableAuth ? acquireChannel(stableAuth) : undefined), [stableAuth])

  const subscribe = useCallback(
    (listener: ChannelFrameListener) =>
      stableAuth ? subscribeChannel(stableAuth, listener) : noop,
    [stableAuth]
  )

  return useMemo(() => ({ status, subscribe }), [status, subscribe])
}
