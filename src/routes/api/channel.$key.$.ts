import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'

import { handleChannelRequest } from '@features/channel'

// Sub-paths of a dock channel (`/events`, `/marks`); the bare key is served by channel.$key.ts
export const Route = createFileRoute('/api/channel/$key/$')({
  server: {
    handlers: {
      ANY: ({ request, params }) => handleChannelRequest(request, params.key, env),
    },
  },
})
