import { plugin } from 'bun'

// `cloudflare:workers` only exists inside the Worker runtime. Feature barrels pull in server
// functions that import it, so unit tests get an empty stand-in; no test calls a handler.
plugin({
  name: 'cloudflare-workers-stub',
  setup: (build) => {
    build.module('cloudflare:workers', () => ({ exports: { env: {} }, loader: 'object' }))
  },
})
