import { describe, expect, it } from 'vitest'

import {
  createPairingPayload,
  mobilePairingCodeSchema,
  parsePairingPayload,
  parseSyncControlMessage,
  parseSyncAuthMessage,
  parseSyncEvent,
  syncAuthAckSchema
} from './index'

const envelope = {
  version: 1,
  eventId: 'event-1',
  sessionId: 'session-1',
  seq: 1,
  timestamp: 1_725_000_000_000
} as const

const validEvents = [
  { ...envelope, type: 'session.reset', payload: {} },
  {
    ...envelope,
    type: 'session.snapshot',
    payload: {
      solution: '完整答案',
      screenshotTotal: 2,
      requestStatus: 'completed',
      errorMessage: null
    }
  },
  { ...envelope, type: 'screenshot.updated', payload: { total: 2 } },
  { ...envelope, type: 'request.started', payload: {} },
  { ...envelope, type: 'solution.delta', payload: { text: 'answer' } },
  { ...envelope, type: 'request.completed', payload: {} },
  { ...envelope, type: 'request.stopped', payload: {} },
  { ...envelope, type: 'request.failed', payload: { message: 'network error' } }
] as const

describe('parseSyncEvent', () => {
  it.each(validEvents)('accepts a valid $type event', (event) => {
    const result = parseSyncEvent(event)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual(event)
    }
  })

  it('rejects an unsupported protocol version', () => {
    const result = parseSyncEvent({
      ...validEvents[3],
      version: 2
    })

    expect(result.success).toBe(false)
  })

  it('rejects an unknown event type', () => {
    const result = parseSyncEvent({
      ...envelope,
      type: 'solution.replaced',
      payload: { text: 'answer' }
    })

    expect(result.success).toBe(false)
  })

  it('rejects an event with a missing envelope field', () => {
    const result = parseSyncEvent({
      version: 1,
      eventId: 'event-1',
      seq: 1,
      timestamp: 1_725_000_000_000,
      type: 'request.started',
      payload: {}
    })

    expect(result.success).toBe(false)
  })

  it('rejects an event with a missing payload field', () => {
    const result = parseSyncEvent({
      ...envelope,
      type: 'solution.delta',
      payload: {}
    })

    expect(result.success).toBe(false)
  })

  it('rejects fields outside the protocol whitelist', () => {
    expect(
      parseSyncEvent({
        ...validEvents[3],
        apiKey: 'secret'
      }).success
    ).toBe(false)
    expect(
      parseSyncEvent({
        ...validEvents[3],
        payload: { text: 'answer', html: '<b>answer</b>' }
      }).success
    ).toBe(false)
  })
})

describe('sync authentication messages', () => {
  it('accepts a strong pairing code and the fixed acknowledgement', () => {
    expect(
      parseSyncAuthMessage({
        type: 'authenticate',
        pairingCode: '0123456789abcdef0123456789abcdef'
      }).success
    ).toBe(true)
    expect(syncAuthAckSchema.safeParse({ type: 'authenticated' }).success).toBe(true)
  })

  it('rejects weak, malformed, or extended authentication messages', () => {
    expect(parseSyncAuthMessage({ type: 'authenticate', pairingCode: 'short' }).success).toBe(false)
    expect(
      parseSyncAuthMessage({
        type: 'authenticate',
        pairingCode: '0123456789abcdef0123456789abcdef',
        role: 'desktop'
      }).success
    ).toBe(false)
  })

  it('accepts only a lowercase SHA-256 digest as a mobile pairing code', () => {
    expect(mobilePairingCodeSchema.safeParse('a'.repeat(64)).success).toBe(true)
    expect(mobilePairingCodeSchema.safeParse('A'.repeat(64)).success).toBe(false)
    expect(mobilePairingCodeSchema.safeParse('a'.repeat(32)).success).toBe(false)
  })
})

describe('pairing QR payload', () => {
  const pairingCode = 'a'.repeat(64)

  it('round-trips a valid pairing payload', () => {
    const encoded = createPairingPayload({
      serverUrl: 'wss://sync.example.com/socket',
      pairingCode
    })

    expect(encoded).not.toBeNull()
    expect(parsePairingPayload(encoded ?? '').success).toBe(true)
  })

  it('accepts local development WebSocket addresses', () => {
    const encoded = createPairingPayload({
      serverUrl: 'ws://127.0.0.1:8787',
      pairingCode
    })

    const parsed = parsePairingPayload(encoded ?? '')
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.serverUrl).toBe('ws://127.0.0.1:8787')
      expect(parsed.data.pairingCode).toBe(pairingCode)
    }
  })

  it('rejects malformed, unsupported, or extended payloads', () => {
    expect(parsePairingPayload('not-json').success).toBe(false)
    expect(
      parsePairingPayload(
        JSON.stringify({
          type: 'interview-coder-pairing',
          version: 2,
          serverUrl: 'wss://sync.example.com',
          pairingCode
        })
      ).success
    ).toBe(false)
    expect(
      parsePairingPayload(
        JSON.stringify({
          type: 'interview-coder-pairing',
          version: 1,
          serverUrl: 'https://sync.example.com',
          pairingCode
        })
      ).success
    ).toBe(false)
    expect(
      parsePairingPayload(
        JSON.stringify({
          type: 'interview-coder-pairing',
          version: 1,
          serverUrl: 'wss://sync.example.com',
          pairingCode,
          apiKey: 'secret'
        })
      ).success
    ).toBe(false)
  })
})

describe('sync control messages', () => {
  const controlMessage = {
    version: 1,
    type: 'control.scroll',
    commandId: 'command-1',
    timestamp: 1_725_000_000_000,
    payload: { direction: 'down' }
  } as const

  it.each(['up', 'down'] as const)('accepts a valid %s scroll command', (direction) => {
    expect(
      parseSyncControlMessage({
        ...controlMessage,
        payload: { direction }
      }).success
    ).toBe(true)
  })

  it('accepts an explicit scroll distance ratio', () => {
    const result = parseSyncControlMessage({
      ...controlMessage,
      payload: { direction: 'down', distanceRatio: 0.75 }
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.payload.distanceRatio).toBe(0.75)
    }
  })

  it('accepts a small distance ratio for continuous scrolling', () => {
    expect(
      parseSyncControlMessage({
        ...controlMessage,
        payload: { direction: 'down', distanceRatio: 0.1 }
      }).success
    ).toBe(true)
  })

  it('rejects malformed or extended control messages', () => {
    expect(
      parseSyncControlMessage({
        ...controlMessage,
        version: 2
      }).success
    ).toBe(false)
    expect(
      parseSyncControlMessage({
        ...controlMessage,
        payload: { direction: 'left' }
      }).success
    ).toBe(false)
    expect(
      parseSyncControlMessage({
        ...controlMessage,
        commandId: ''
      }).success
    ).toBe(false)
    expect(
      parseSyncControlMessage({
        ...controlMessage,
        apiKey: 'secret'
      }).success
    ).toBe(false)
    expect(
      parseSyncControlMessage({
        ...controlMessage,
        payload: { direction: 'down', distanceRatio: 0 }
      }).success
    ).toBe(false)
    expect(
      parseSyncControlMessage({
        ...controlMessage,
        payload: { direction: 'down', distanceRatio: 1.1 }
      }).success
    ).toBe(false)
  })
})
