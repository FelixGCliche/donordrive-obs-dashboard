import {
  createServerEntry,
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'

// Durable Object classes must be exported from the Worker's main module
export { DockChannel } from '@features/channel'
export { ParticipantSnapshot } from '@features/donordrive'

const fetch = createStartHandler(defaultStreamHandler)

export default createServerEntry({ fetch })
