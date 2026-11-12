import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'

import { handleChannelRequest } from '@features/channel'

export const Route = createFileRoute('/api/channel/$key')({
  server: {
    handlers: {
      ANY: ({ request, params }) => handleChannelRequest(request, params.key, env),
    },
  },
})
