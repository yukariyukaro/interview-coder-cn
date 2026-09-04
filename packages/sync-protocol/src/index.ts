import { z } from 'zod'

export const SYNC_PROTOCOL_VERSION = 1 as const
export const MIN_PAIRING_CODE_LENGTH = 32
export const MOBILE_PAIRING_CODE_DERIVATION_CONTEXT = 'interview-coder-mobile-v1:'

export const syncAuthMessageSchema = z.strictObject({
  type: z.literal('authenticate'),
  pairingCode: z
    .string()
    .min(MIN_PAIRING_CODE_LENGTH)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
})

export const syncAuthAckSchema = z.strictObject({
  type: z.literal('authenticated')
})

export const mobilePairingCodeSchema = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]+$/)

const syncServerUrlSchema = z
  .string()
  .trim()
  .superRefine((value, context) => {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      context.addIssue({ code: 'custom', message: 'Invalid sync server URL' })
      return
    }

    if (!['ws:', 'wss:'].includes(url.protocol)) {
      context.addIssue({ code: 'custom', message: 'Unsupported sync server protocol' })
    }
    if (url.search || url.hash || url.username || url.password) {
      context.addIssue({ code: 'custom', message: 'Unexpected sync server URL fields' })
    }
  })

export const pairingPayloadSchema = z.strictObject({
  type: z.literal('interview-coder-pairing'),
  version: z.literal(SYNC_PROTOCOL_VERSION),
  serverUrl: syncServerUrlSchema,
  pairingCode: mobilePairingCodeSchema
})

export type SyncAuthMessage = z.infer<typeof syncAuthMessageSchema>
export type SyncAuthAck = z.infer<typeof syncAuthAckSchema>
export type PairingPayload = z.infer<typeof pairingPayloadSchema>

export function parseSyncAuthMessage(input: unknown) {
  return syncAuthMessageSchema.safeParse(input)
}

export function createPairingPayload(input: {
  serverUrl: string
  pairingCode: string
}): string | null {
  const parsed = pairingPayloadSchema.safeParse({
    type: 'interview-coder-pairing',
    version: SYNC_PROTOCOL_VERSION,
    serverUrl: input.serverUrl,
    pairingCode: input.pairingCode
  })
  return parsed.success ? JSON.stringify(parsed.data) : null
}

export function parsePairingPayload(input: string) {
  try {
    return pairingPayloadSchema.safeParse(JSON.parse(input))
  } catch {
    return pairingPayloadSchema.safeParse(null)
  }
}

export const syncControlMessageSchema = z.strictObject({
  version: z.literal(SYNC_PROTOCOL_VERSION),
  type: z.literal('control.scroll'),
  commandId: z.string().min(1).max(128),
  timestamp: z.number().int().nonnegative(),
  payload: z.strictObject({
    direction: z.enum(['up', 'down'])
  })
})

export type SyncControlMessage = z.infer<typeof syncControlMessageSchema>
export type ScrollDirection = SyncControlMessage['payload']['direction']

export function parseSyncControlMessage(input: unknown) {
  return syncControlMessageSchema.safeParse(input)
}

export type SyncEventType =
  | 'session.reset'
  | 'session.snapshot'
  | 'screenshot.updated'
  | 'request.started'
  | 'solution.delta'
  | 'request.completed'
  | 'request.stopped'
  | 'request.failed'

export type EventEnvelope<TType extends SyncEventType, TPayload> = {
  version: typeof SYNC_PROTOCOL_VERSION
  eventId: string
  sessionId: string
  seq: number
  timestamp: number
  type: TType
  payload: TPayload
}

export type SyncEvent =
  | EventEnvelope<'session.reset', Record<string, never>>
  | EventEnvelope<
      'session.snapshot',
      {
        solution: string
        screenshotTotal: number
        requestStatus: 'idle' | 'loading' | 'completed' | 'stopped' | 'failed'
        errorMessage: string | null
      }
    >
  | EventEnvelope<'screenshot.updated', { total: number }>
  | EventEnvelope<'request.started', Record<string, never>>
  | EventEnvelope<'solution.delta', { text: string }>
  | EventEnvelope<'request.completed', Record<string, never>>
  | EventEnvelope<'request.stopped', Record<string, never>>
  | EventEnvelope<'request.failed', { message: string }>

const envelopeShape = {
  version: z.literal(SYNC_PROTOCOL_VERSION),
  eventId: z.string().min(1),
  sessionId: z.string().min(1),
  seq: z.number().int().positive(),
  timestamp: z.number().int().nonnegative()
}

const emptyPayloadSchema = z.strictObject({})

const syncEventSchema: z.ZodType<SyncEvent> = z.discriminatedUnion('type', [
  z.strictObject({
    ...envelopeShape,
    type: z.literal('session.reset'),
    payload: emptyPayloadSchema
  }),
  z.strictObject({
    ...envelopeShape,
    type: z.literal('session.snapshot'),
    payload: z.strictObject({
      solution: z.string(),
      screenshotTotal: z.number().int().nonnegative(),
      requestStatus: z.enum(['idle', 'loading', 'completed', 'stopped', 'failed']),
      errorMessage: z.string().nullable()
    })
  }),
  z.strictObject({
    ...envelopeShape,
    type: z.literal('screenshot.updated'),
    payload: z.strictObject({
      total: z.number().int().nonnegative()
    })
  }),
  z.strictObject({
    ...envelopeShape,
    type: z.literal('request.started'),
    payload: emptyPayloadSchema
  }),
  z.strictObject({
    ...envelopeShape,
    type: z.literal('solution.delta'),
    payload: z.strictObject({
      text: z.string()
    })
  }),
  z.strictObject({
    ...envelopeShape,
    type: z.literal('request.completed'),
    payload: emptyPayloadSchema
  }),
  z.strictObject({
    ...envelopeShape,
    type: z.literal('request.stopped'),
    payload: emptyPayloadSchema
  }),
  z.strictObject({
    ...envelopeShape,
    type: z.literal('request.failed'),
    payload: z.strictObject({
      message: z.string()
    })
  })
])

export function parseSyncEvent(input: unknown) {
  return syncEventSchema.safeParse(input)
}
