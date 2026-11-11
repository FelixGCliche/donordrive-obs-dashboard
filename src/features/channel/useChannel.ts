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

/** Opens one WebSocket to the dock channel and exposes its status and frames. */
export const useChannel = (_options: UseChannelOptions): UseChannelResult => {
  throw new Error('not implemented')
}
