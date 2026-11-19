import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { z } from 'zod'

import {
  callChannel,
  CHANNEL_ID_PATTERN,
  CREDENTIAL_PATTERN,
  marksOpSchema,
  marksSchema,
} from '@features/channel'
import type { ChannelEnv, Marks } from '@features/channel'

import { marksErrorMessage } from './marksErrors'

const authInputSchema = z.object({
  channelId: z.string().regex(CHANNEL_ID_PATTERN),
  credential: z.string().regex(CREDENTIAL_PATTERN),
})

const updateInputSchema = authInputSchema.extend({ op: marksOpSchema })

/**
 * The single place marks code touches the Worker env.
 * `cloudflare:workers` types `env` as the global `Cloudflare.Env`; the channel feature owns the
 * `DOCK_CHANNEL` binding type, so narrow to `ChannelEnv` here. Call only inside a handler.
 */
const getChannelEnv = (): ChannelEnv => env as ChannelEnv

const readMarks = async (response: Response): Promise<Marks> => {
  if (!response.ok) throw new Error(marksErrorMessage(response.status))
  return marksSchema.parse(await response.json())
}

/** Reads the full marks state of a channel. POST keeps the credential out of the request URL. */
export const getMarks = createServerFn({ method: 'POST' })
  .validator(authInputSchema)
  .handler(async ({ data }): Promise<Marks> => {
    const { channelId, credential } = data
    const response = await callChannel(getChannelEnv(), { channelId, credential }, '/marks')
    return readMarks(response)
  })

/** Applies one marks op to a channel (owner key only) and returns the new full state. */
export const updateMarks = createServerFn({ method: 'POST' })
  .validator(updateInputSchema)
  .handler(async ({ data }): Promise<Marks> => {
    const { channelId, credential, op } = data
    const response = await callChannel(getChannelEnv(), { channelId, credential }, '/marks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(op),
    })
    return readMarks(response)
  })
