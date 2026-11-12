import { createServerFn } from '@tanstack/react-start'
import { env } from 'cloudflare:workers'
import { z } from 'zod'

import { callChannel, DOCK_KEY_PATTERN, marksOpSchema, marksSchema } from '@features/channel'
import type { ChannelEnv, Marks } from '@features/channel'

const keyInputSchema = z.object({ key: z.string().regex(DOCK_KEY_PATTERN) })

const updateInputSchema = keyInputSchema.extend({ op: marksOpSchema })

/**
 * The single place marks code touches the Worker env.
 * `cloudflare:workers` types `env` as the global `Cloudflare.Env`; the channel feature owns the
 * `DOCK_CHANNEL` binding type, so narrow to `ChannelEnv` here. Call only inside a handler.
 */
const getChannelEnv = (): ChannelEnv => env as ChannelEnv

const readMarks = async (response: Response): Promise<Marks> => {
  if (!response.ok) {
    throw new Error(`Marks request failed (${response.status})`)
  }
  return marksSchema.parse(await response.json())
}

/** Reads the full marks state of a dock key. */
export const getMarks = createServerFn({ method: 'GET' })
  .validator(keyInputSchema)
  .handler(async ({ data }): Promise<Marks> => {
    const response = await callChannel(getChannelEnv(), data.key, '/marks')
    return readMarks(response)
  })

/** Applies one marks op to a dock key and returns the new full state. */
export const updateMarks = createServerFn({ method: 'POST' })
  .validator(updateInputSchema)
  .handler(async ({ data }): Promise<Marks> => {
    const response = await callChannel(getChannelEnv(), data.key, '/marks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data.op),
    })
    return readMarks(response)
  })
