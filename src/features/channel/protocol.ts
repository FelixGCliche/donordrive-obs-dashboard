import { z } from 'zod'

/** Dock key format: the dock's password, also the Durable Object name. */
export const DOCK_KEY_PATTERN = /^[A-Za-z0-9_-]{22,64}$/

export const RELAY_PROTOCOL_VERSION = 1

// MVP-SHORTCUT(MVP-10): only two event types; the hero name is the raw donor message
export const relayEventTypes = ['donation.created', 'incentive.redeemed'] as const

export type RelayEventType = (typeof relayEventTypes)[number]

export type RelayEventId = `${RelayEventType}:${string}`

/** Deterministic event id, so several open docks publishing the same donation dedupe. */
export const eventId = (type: RelayEventType, donationId: string): RelayEventId =>
  `${type}:${donationId}`

const idSchema = z.string().min(1).max(128)
const idListSchema = z.array(idSchema).max(2000)

export const relayEventDataSchema = z.object({
  donationId: idSchema,
  displayName: z.string(),
  /** null when the donor hid the amount */
  amount: z.number().nullable(),
  message: z.string().optional(),
  incentiveId: idSchema.optional(),
  incentiveDescription: z.string().optional(),
})

export const relayEventSchema = z
  .object({
    v: z.literal(RELAY_PROTOCOL_VERSION),
    /** `${type}:${donationId}` */
    id: z.string().min(1).max(160),
    type: z.enum(relayEventTypes),
    /** ISO 8601 timestamp */
    ts: z.string().min(1),
    test: z.boolean(),
    participantId: z.string().min(1).max(64),
    data: relayEventDataSchema,
  })
  .refine((event) => event.id === eventId(event.type, event.data.donationId), {
    message: 'id must be `${type}:${data.donationId}`',
    path: ['id'],
  })

export type RelayEventData = z.infer<typeof relayEventDataSchema>
export type RelayEvent = z.infer<typeof relayEventSchema>

/** Full marks state of a dock key; `version` bumps on every change. */
export const marksSchema = z.object({
  version: z.number().int().nonnegative(),
  read: z.array(idSchema),
  fulfilled: z.array(idSchema),
  baselined: z.boolean(),
})

export type Marks = z.infer<typeof marksSchema>

export const marksOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.enum(['read', 'unread', 'fulfill', 'unfulfill']), ids: idListSchema }),
  // Applied once per key only (see MVP-09 in docs/mvp-shortcuts.md)
  z.object({ op: z.literal('baseline'), ids: idListSchema }),
])

export type MarksOp = z.infer<typeof marksOpSchema>
export type MarksOpKind = MarksOp['op']

/** Frames the channel sends to a connected socket. */
export const serverFrameSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('hello'), key: z.string() }),
  z.object({ kind: z.literal('replay'), events: z.array(relayEventSchema) }),
  z.object({ kind: z.literal('event'), event: relayEventSchema }),
  /** Full marks state, sent after every change */
  z.object({ kind: z.literal('marks'), marks: marksSchema }),
])

export type ServerFrame = z.infer<typeof serverFrameSchema>
