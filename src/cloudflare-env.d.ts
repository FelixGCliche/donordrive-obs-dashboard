// Worker bindings, typed by hand: the full @cloudflare/workers-types globals (and `wrangler types`
// with the runtime) clash with the DOM lib this app type-checks against.
declare module 'cloudflare:workers' {
  /** Bindings declared in wrangler.jsonc */
  export const env: import('./features/channel').ChannelEnv
}
