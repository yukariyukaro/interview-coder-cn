import { randomUUID } from 'node:crypto'

import type { SyncEvent } from '@interview-coder/sync-protocol'
import {
  DEFAULT_SCROLL_DISTANCE_RATIO,
  SYNC_PROTOCOL_VERSION,
  parseSyncControlMessage,
  parseSyncEvent,
  syncAuthAckSchema,
  type ScrollDirection
} from '@interview-coder/sync-protocol'
import WebSocket from 'ws'

import { solutionEventPublisher } from '../solution/solution-events'

const PAIRING_CODE_PATTERN = /^[A-Za-z0-9_-]{32,64}$/
const SOCKET_CONNECTING = 0
const SOCKET_OPEN = 1
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000
const DEFAULT_RETRY_MAX_DELAY_MS = 30_000
// A freshly authenticated socket that is immediately dropped (oversized snapshot,
// backpressure terminate, etc.) must not reset the backoff, otherwise the client
// reconnects once per second. Only clear the backoff after it stays up this long.
const DEFAULT_RETRY_STABLE_DELAY_MS = 10_000
// Additive jitter ratio on top of the exponential delay to avoid synchronized retries.
const RETRY_JITTER_RATIO = 0.2

export type MobileSyncConfig = {
  syncEnabled: boolean
  syncServerUrl: string
  syncPairingCode: string
}

export type MobileSyncSocket = {
  readyState: number
  on(event: string, listener: (...args: unknown[]) => void): MobileSyncSocket
  send(data: string): void
  close(): void
}

export type MobileSyncSocketFactory = (url: string) => MobileSyncSocket

type TimerHandle = unknown

export type MobileSyncClientOptions = {
  createSocket?: MobileSyncSocketFactory
  getSnapshot: () => SyncEvent
  setTimer?: (callback: () => void, delay: number) => TimerHandle
  clearTimer?: (handle: TimerHandle) => void
  retryBaseDelayMs?: number
  retryMaxDelayMs?: number
  retryStableDelayMs?: number
  random?: () => number
  createCommandId?: () => string
  now?: () => number
}

export type MobileSyncClient = {
  configure(config: MobileSyncConfig): void
  send(event: SyncEvent): boolean
  sendScrollCommand(direction: ScrollDirection, distanceRatio?: number): boolean
  close(): void
}

function createConnectionUrl(config: MobileSyncConfig): string | null {
  if (!config.syncEnabled) return null

  const serverUrl = config.syncServerUrl.trim()
  const pairingCode = config.syncPairingCode.trim()
  if (!serverUrl || !PAIRING_CODE_PATTERN.test(pairingCode)) return null

  let parsedUrl: URL
  try {
    parsedUrl = new URL(serverUrl)
  } catch {
    return null
  }
  if (!['ws:', 'wss:'].includes(parsedUrl.protocol)) return null
  const isLoopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsedUrl.hostname)
  if (parsedUrl.protocol === 'ws:' && !isLoopback) return null
  if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) return null

  return `${serverUrl}?role=desktop`
}

function sameConfig(left: MobileSyncConfig | null, right: MobileSyncConfig): boolean {
  return (
    left?.syncEnabled === right.syncEnabled &&
    left.syncServerUrl === right.syncServerUrl &&
    left.syncPairingCode === right.syncPairingCode
  )
}

export function createMobileSyncClient(options: MobileSyncClientOptions): MobileSyncClient {
  const createSocket =
    options.createSocket ?? ((url: string) => new WebSocket(url) as unknown as MobileSyncSocket)
  const setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay))
  const clearTimer =
    options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS
  const retryMaxDelayMs = options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS
  const retryStableDelayMs = options.retryStableDelayMs ?? DEFAULT_RETRY_STABLE_DELAY_MS
  const random = options.random ?? Math.random
  const createCommandId = options.createCommandId ?? randomUUID
  const now = options.now ?? Date.now

  let config: MobileSyncConfig | null = null
  let socket: MobileSyncSocket | null = null
  let reconnectTimer: TimerHandle | null = null
  let stabilityTimer: TimerHandle | null = null
  let retryAttempt = 0
  let generation = 0
  let authenticated = false

  function clearReconnectTimer(): void {
    if (reconnectTimer === null) return
    clearTimer(reconnectTimer)
    reconnectTimer = null
  }

  function clearStabilityTimer(): void {
    if (stabilityTimer === null) return
    clearTimer(stabilityTimer)
    stabilityTimer = null
  }

  function disconnect(): void {
    generation += 1
    clearReconnectTimer()
    clearStabilityTimer()
    const activeSocket = socket
    socket = null
    authenticated = false
    if (!activeSocket) return
    if (activeSocket.readyState === SOCKET_CONNECTING || activeSocket.readyState === SOCKET_OPEN) {
      activeSocket.close()
    }
  }

  function scheduleReconnect(connectionGeneration: number): void {
    if (!config || !createConnectionUrl(config) || reconnectTimer !== null) return
    const cappedDelay = Math.min(retryBaseDelayMs * 2 ** retryAttempt, retryMaxDelayMs)
    const delay = Math.round(cappedDelay * (1 + random() * RETRY_JITTER_RATIO))
    retryAttempt += 1
    reconnectTimer = setTimer(() => {
      reconnectTimer = null
      if (connectionGeneration !== generation) return
      connect(connectionGeneration)
    }, delay)
  }

  function send(event: SyncEvent): boolean {
    if (!authenticated || !socket || socket.readyState !== SOCKET_OPEN) return false
    const parsed = parseSyncEvent(event)
    if (!parsed.success) return false
    try {
      socket.send(JSON.stringify(parsed.data))
      return true
    } catch {
      return false
    }
  }

  function sendScrollCommand(
    direction: ScrollDirection,
    distanceRatio = DEFAULT_SCROLL_DISTANCE_RATIO
  ): boolean {
    if (!authenticated || !socket || socket.readyState !== SOCKET_OPEN) return false
    const parsed = parseSyncControlMessage({
      version: SYNC_PROTOCOL_VERSION,
      type: 'control.scroll',
      commandId: createCommandId(),
      timestamp: now(),
      payload: { direction, distanceRatio }
    })
    if (!parsed.success) return false
    try {
      socket.send(JSON.stringify(parsed.data))
      return true
    } catch {
      return false
    }
  }

  function connect(connectionGeneration: number): void {
    if (!config || connectionGeneration !== generation) return
    const connectionConfig = config
    const url = createConnectionUrl(connectionConfig)
    if (!url) return

    let nextSocket: MobileSyncSocket
    try {
      nextSocket = createSocket(url)
    } catch {
      scheduleReconnect(connectionGeneration)
      return
    }
    socket = nextSocket
    authenticated = false
    nextSocket.on('open', () => {
      if (socket !== nextSocket || connectionGeneration !== generation) return
      nextSocket.send(
        JSON.stringify({
          type: 'authenticate',
          pairingCode: connectionConfig.syncPairingCode.trim()
        })
      )
    })
    nextSocket.on('message', (data) => {
      if (socket !== nextSocket || connectionGeneration !== generation || authenticated) return
      try {
        const input = JSON.parse(String(data))
        if (!syncAuthAckSchema.safeParse(input).success) {
          nextSocket.close()
          return
        }
      } catch {
        nextSocket.close()
        return
      }
      authenticated = true
      // Defer clearing the backoff until the socket proves stable, so a connection
      // that authenticates then immediately drops keeps escalating its retry delay.
      clearStabilityTimer()
      stabilityTimer = setTimer(() => {
        stabilityTimer = null
        if (socket === nextSocket && connectionGeneration === generation) retryAttempt = 0
      }, retryStableDelayMs)
      send(options.getSnapshot())
    })
    nextSocket.on('close', () => {
      if (socket !== nextSocket || connectionGeneration !== generation) return
      socket = null
      authenticated = false
      clearStabilityTimer()
      scheduleReconnect(connectionGeneration)
    })
    nextSocket.on('error', () => undefined)
  }

  return {
    configure(nextConfig) {
      if (sameConfig(config, nextConfig)) return
      disconnect()
      config = { ...nextConfig }
      retryAttempt = 0
      const url = createConnectionUrl(config)
      if (!url) return
      connect(generation)
    },

    send,
    sendScrollCommand,

    close() {
      config = null
      retryAttempt = 0
      disconnect()
    }
  }
}

const mobileSyncClient = createMobileSyncClient({
  getSnapshot: () => solutionEventPublisher.getSnapshot()
})

solutionEventPublisher.addSink((event) => {
  mobileSyncClient.send(event)
})

export function configureMobileSync(config: MobileSyncConfig): void {
  mobileSyncClient.configure(config)
}

export function sendMobileScrollCommand(
  direction: ScrollDirection,
  distanceRatio = DEFAULT_SCROLL_DISTANCE_RATIO
): boolean {
  return mobileSyncClient.sendScrollCommand(direction, distanceRatio)
}
