import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'

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

export type UseChannelOptions = {
  /** Dock key; no socket is opened while it is undefined */
  key: string | undefined
}

const noop = () => {}

/** Opens one WebSocket to the dock channel and exposes its status and frames. */
export const useChannel = ({ key }: UseChannelOptions): UseChannelResult => {
  const watchStatus = useCallback(
    (listener: () => void) => (key ? watchChannelStatus(key, listener) : noop),
    [key]
  )
  const getStatus = useCallback((): ChannelStatus => (key ? readChannelStatus(key) : 'idle'), [key])
  const getServerStatus = useCallback((): ChannelStatus => (key ? 'connecting' : 'idle'), [key])
  const status = useSyncExternalStore(watchStatus, getStatus, getServerStatus)

  // The socket is opened in an effect only, so nothing touches `window` during render or SSR
  useEffect(() => (key ? acquireChannel(key) : undefined), [key])

  const subscribe = useCallback(
    (listener: ChannelFrameListener) => (key ? subscribeChannel(key, listener) : noop),
    [key]
  )

  return useMemo(() => ({ status, subscribe }), [status, subscribe])
}
