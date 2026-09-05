import type { SyncEvent } from '@interview-coder/sync-protocol'
import { describe, expect, it, vi } from 'vitest'

import {
  createMobileSyncClient,
  type MobileSyncSocket,
  type MobileSyncSocketFactory
} from './mobile-sync'

class FakeSocket implements MobileSyncSocket {
  readyState = 0
  sent: string[] = []
  close = vi.fn(() => {
    this.readyState = 3
  })
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>()

  on(event: string, listener: (...args: unknown[]) => void): this {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
    return this
  }

  removeAllListeners(): this {
    this.listeners.clear()
    return this
  }

  send(data: string): void {
    this.sent.push(data)
  }

  emit(event: string, ...args: unknown[]): void {
    if (event === 'open') this.readyState = 1
    if (event === 'close') this.readyState = 3
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}

const snapshot: SyncEvent = {
  version: 1,
  eventId: 'snapshot-1',
  sessionId: 'session-1',
  seq: 1,
  timestamp: 1_725_000_000_000,
  type: 'session.snapshot',
  payload: {
    solution: '',
    screenshotTotal: 0,
    requestStatus: 'idle',
    errorMessage: null
  }
}

function createHarness() {
  const sockets: FakeSocket[] = []
  const urls: string[] = []
  const scheduled: Array<{ callback: () => void; delay: number }> = []
  let commandSequence = 0
  const createSocket: MobileSyncSocketFactory = (url) => {
    urls.push(url)
    const socket = new FakeSocket()
    sockets.push(socket)
    return socket
  }
  const client = createMobileSyncClient({
    createSocket,
    getSnapshot: () => snapshot,
    setTimer: (callback, delay) => {
      scheduled.push({ callback, delay })
      return callback
    },
    clearTimer: vi.fn(),
    random: () => 0,
    createCommandId: () => `command-${++commandSequence}`,
    now: () => 1_725_000_000_000
  })
  return { client, sockets, urls, scheduled }
}

describe('createMobileSyncClient', () => {
  it.each([
    {
      syncEnabled: false,
      syncServerUrl: 'ws://localhost:8787',
      syncPairingCode: '0123456789abcdef0123456789abcdef'
    },
    { syncEnabled: true, syncServerUrl: '', syncPairingCode: '0123456789abcdef0123456789abcdef' },
    { syncEnabled: true, syncServerUrl: 'ws://localhost:8787', syncPairingCode: '' },
    {
      syncEnabled: true,
      syncServerUrl: 'https://localhost:8787',
      syncPairingCode: '0123456789abcdef0123456789abcdef'
    },
    {
      syncEnabled: true,
      syncServerUrl: 'ws://192.168.1.10:8787',
      syncPairingCode: '0123456789abcdef0123456789abcdef'
    },
    { syncEnabled: true, syncServerUrl: 'ws://localhost:8787', syncPairingCode: 'bad code' }
  ])('does not connect with disabled or incomplete configuration', (config) => {
    const { client, urls } = createHarness()

    client.configure(config)

    expect(urls).toEqual([])
  })

  it('connects as desktop and sends the current snapshot when opened', () => {
    const { client, sockets, urls } = createHarness()

    client.configure({
      syncEnabled: true,
      syncServerUrl: 'wss://sync.example.com/socket',
      syncPairingCode: 'abcdef0123456789abcdef0123456789'
    })
    sockets[0].emit('open')
    expect(sockets[0].sent.map((message) => JSON.parse(message))).toEqual([
      { type: 'authenticate', pairingCode: 'abcdef0123456789abcdef0123456789' }
    ])
    sockets[0].emit('message', JSON.stringify({ type: 'authenticated' }))

    expect(urls).toEqual(['wss://sync.example.com/socket?role=desktop'])
    expect(sockets[0].sent.map((message) => JSON.parse(message))).toEqual([
      { type: 'authenticate', pairingCode: 'abcdef0123456789abcdef0123456789' },
      snapshot
    ])
  })

  it('sends only valid protocol events while connected', () => {
    const { client, sockets } = createHarness()
    client.configure({
      syncEnabled: true,
      syncServerUrl: 'ws://localhost:8787',
      syncPairingCode: '0123456789abcdef0123456789abcdef'
    })
    sockets[0].emit('open')
    sockets[0].emit('message', JSON.stringify({ type: 'authenticated' }))
    const event: SyncEvent = {
      ...snapshot,
      eventId: 'event-2',
      seq: 2,
      type: 'screenshot.updated',
      payload: { total: 1 }
    }

    expect(client.send(event)).toBe(true)
    expect(
      client.send({
        ...event,
        payload: { total: 1, screenshotData: 'data:image/png;base64,secret' }
      } as SyncEvent)
    ).toBe(false)
    expect(sockets[0].sent).toHaveLength(3)
    expect(sockets[0].sent.join('')).not.toContain('base64')
  })

  it('sends unique scroll commands only while authenticated', () => {
    const { client, sockets } = createHarness()
    client.configure({
      syncEnabled: true,
      syncServerUrl: 'ws://localhost:8787',
      syncPairingCode: '0123456789abcdef0123456789abcdef'
    })

    expect(client.sendScrollCommand('down')).toBe(false)
    sockets[0].emit('open')
    expect(client.sendScrollCommand('down')).toBe(false)
    sockets[0].emit('message', JSON.stringify({ type: 'authenticated' }))

    expect(client.sendScrollCommand('down')).toBe(true)
    expect(client.sendScrollCommand('down', 0.1)).toBe(true)
    expect(sockets[0].sent.map((message) => JSON.parse(message)).slice(-2)).toEqual([
      {
        version: 1,
        type: 'control.scroll',
        commandId: 'command-1',
        timestamp: 1_725_000_000_000,
        payload: { direction: 'down', distanceRatio: 0.75 }
      },
      {
        version: 1,
        type: 'control.scroll',
        commandId: 'command-2',
        timestamp: 1_725_000_000_000,
        payload: { direction: 'down', distanceRatio: 0.1 }
      }
    ])

    sockets[0].emit('close')
    expect(client.sendScrollCommand('up')).toBe(false)
  })

  it('closes the active socket and cancels reconnect when disabled', () => {
    const { client, sockets, scheduled } = createHarness()
    client.configure({
      syncEnabled: true,
      syncServerUrl: 'ws://localhost:8787',
      syncPairingCode: '0123456789abcdef0123456789abcdef'
    })

    client.configure({
      syncEnabled: false,
      syncServerUrl: 'ws://localhost:8787',
      syncPairingCode: '0123456789abcdef0123456789abcdef'
    })

    expect(sockets[0].close).toHaveBeenCalled()
    sockets[0].emit('close')
    expect(scheduled).toHaveLength(0)
    expect(sockets).toHaveLength(1)
  })

  it('resets backoff only after the connection stays up long enough', () => {
    const { client, sockets, scheduled } = createHarness()
    client.configure({
      syncEnabled: true,
      syncServerUrl: 'ws://localhost:8787',
      syncPairingCode: '0123456789abcdef0123456789abcdef'
    })

    sockets[0].emit('close')
    expect(scheduled[0].delay).toBe(1_000)
    scheduled[0].callback()
    sockets[1].emit('close')
    expect(scheduled[1].delay).toBe(2_000)
    scheduled[1].callback()
    sockets[2].emit('open')
    sockets[2].emit('message', JSON.stringify({ type: 'authenticated' }))
    // Authentication schedules a stability timer; firing it clears the backoff.
    expect(scheduled[2].delay).toBe(10_000)
    scheduled[2].callback()
    sockets[2].emit('close')
    expect(scheduled[3].delay).toBe(1_000)
  })

  it('keeps escalating backoff when a connection drops before it stabilizes', () => {
    const { client, sockets, scheduled } = createHarness()
    client.configure({
      syncEnabled: true,
      syncServerUrl: 'ws://localhost:8787',
      syncPairingCode: '0123456789abcdef0123456789abcdef'
    })

    sockets[0].emit('close')
    expect(scheduled[0].delay).toBe(1_000)
    scheduled[0].callback()
    sockets[1].emit('open')
    sockets[1].emit('message', JSON.stringify({ type: 'authenticated' }))
    // Stability timer is scheduled but never fires: the socket drops first.
    expect(scheduled[1].delay).toBe(10_000)
    sockets[1].emit('close')
    expect(scheduled[2].delay).toBe(2_000)
  })
})
