import { createServerFn } from '@tanstack/react-start'
import { getRequestIP } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import { z } from 'zod'

import type { CreatedChannel } from './channelAdmin'
import { createChannelWith, rotateCredentialWith } from './channelAdmin'
import { CHANNEL_ID_PATTERN, channelRoles, OWNER_KEY_PATTERN } from './channelAuth'
import type { ChannelEnv } from './channelClient'

const rotateInputSchema = z.object({
  channelId: z.string().regex(CHANNEL_ID_PATTERN),
  ownerKey: z.string().regex(OWNER_KEY_PATTERN),
  role: z.enum(channelRoles),
})

/** `cloudflare:workers` types `env` as the global `Cloudflare.Env`; call only inside a handler. */
const getChannelEnv = (): ChannelEnv => env as ChannelEnv

/** User-facing message for a failed channel creation or credential rotation. */
export const credentialsErrorMessage = (action: string, status: number): string => {
  if (status === 401) return `${action} failed: the owner key is no longer valid for this channel.`
  if (status === 403) return `${action} failed: only the owner key can do this.`
  if (status === 429) return `${action} failed: too many requests. Try again in a minute.`
  return `${action} failed (${status}).`
}

const failure = (action: string, response: Response): Error =>
  new Error(credentialsErrorMessage(action, response.status))

/** Creates a channel and returns its ID, owner key and subscribe token in plaintext. */
export const createChannel = createServerFn({ method: 'POST' }).handler(
  async (): Promise<CreatedChannel> => {
    const ip = getRequestIP({ xForwardedFor: true }) ?? 'unknown'
    const result = await createChannelWith(getChannelEnv(), ip)
    if (result instanceof Response) throw failure('Channel creation', result)
    return result
  }
)

/** Replaces the owner key or subscribe token of a channel; needs the current owner key. */
export const rotateChannelCredential = createServerFn({ method: 'POST' })
  .validator(rotateInputSchema)
  .handler(async ({ data }): Promise<{ credential: string }> => {
    const auth = { channelId: data.channelId, credential: data.ownerKey }
    const result = await rotateCredentialWith(getChannelEnv(), auth, data.role)
    if (result instanceof Response) throw failure('Credential rotation', result)
    return result
  })
