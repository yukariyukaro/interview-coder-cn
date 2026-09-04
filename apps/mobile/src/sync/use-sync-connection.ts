import {
  mobilePairingCodeSchema,
  parseSyncControlMessage,
  parseSyncEvent,
  syncAuthAckSchema,
  type ScrollDirection
} from '@interview-coder/sync-protocol'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ConnectionSettings } from '../storage/connection-settings'
import { initialSessionState, sessionReducer, type SessionState } from './session-reducer'

const INITIAL_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 30_000
const STABLE_CONNECTION_MS = 10_000
const isDevelopmentBuild = typeof __DEV__ !== 'undefined' && __DEV__

export type ConnectionState =
  | { status: 'disconnected' }
  | { status: 'connecting' }
  | { status: 'connected' }
  | { status: 'error'; message: string; kind: 'configuration' | 'protocol' }

export type ScrollCommand = {
  commandId: string
  direction: ScrollDirection
}

type UseSyncConnectionResult = {
  connectionState: ConnectionState
  sessionState: SessionState
  scrollCommand: ScrollCommand | null
  reconnect: () => void
}

function createConnectionUrl(settings: ConnectionSettings): string {
  const serverUrl = settings.serverUrl.trim()
  const pairingCode = settings.pairingCode.trim()
  let url: URL
  try {
    url = new URL(serverUrl)
  } catch {
    throw new Error('服务器地址格式无效')
  }

  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error('服务器地址必须使用 ws:// 或 wss://')
  }
  const isLoopback = ['localhost', '127.0.0.1', '[::1]', '::1', '10.0.2.2'].includes(url.hostname)
  if (url.protocol === 'ws:' && !isLoopback && !isDevelopmentBuild) {
    throw new Error('远程同步服务必须使用 wss://')
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new Error('服务器地址不能包含鉴权信息、查询参数或锚点')
  }
  if (!mobilePairingCodeSchema.safeParse(pairingCode).success) {
    throw new Error('手机配对码必须是 64 位小写十六进制字符')
  }

  url.searchParams.set('role', 'mobile')
  return url.toString()
}

export function useSyncConnection(settings: ConnectionSettings | null): UseSyncConnectionResult {
  const [connectionState, setConnectionState] = useState<ConnectionState>({
    status: 'disconnected'
  })
  const [sessionState, setSessionState] = useState(initialSessionState)
  const [scrollCommand, setScrollCommand] = useState<ScrollCommand | null>(null)
  const sessionRef = useRef(initialSessionState)
  const lastCommandIdRef = useRef<string | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const [reconnectToken, setReconnectToken] = useState(0)
  const serverUrl = settings?.serverUrl
  const pairingCode = settings?.pairingCode

  const reconnect = useCallback(() => {
    setReconnectToken((value) => value + 1)
  }, [])

  useEffect(() => {
    sessionRef.current = initialSessionState
    setSessionState(initialSessionState)
    lastCommandIdRef.current = null
    setScrollCommand(null)

    if (serverUrl === undefined || pairingCode === undefined) {
      socketRef.current?.close()
      socketRef.current = null
      setConnectionState({ status: 'disconnected' })
      return
    }

    let connectionUrl: string
    try {
      connectionUrl = createConnectionUrl({ serverUrl, pairingCode })
    } catch (error) {
      setConnectionState({
        status: 'error',
        kind: 'configuration',
        message: error instanceof Error ? error.message : '连接配置无效'
      })
      return
    }

    let disposed = false
    let protocolFailed = false
    let retryAttempt = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let stabilityTimer: ReturnType<typeof setTimeout> | null = null

    const scheduleReconnect = (): void => {
      if (disposed || protocolFailed) return
      const delay = Math.min(INITIAL_RETRY_DELAY_MS * 2 ** retryAttempt, MAX_RETRY_DELAY_MS)
      retryAttempt += 1
      setConnectionState({ status: 'connecting' })
      retryTimer = setTimeout(connect, delay)
    }

    const failProtocol = (message: string): void => {
      protocolFailed = true
      const nextState = sessionReducer(sessionRef.current, {
        type: 'protocol.error',
        message
      })
      sessionRef.current = nextState
      setSessionState(nextState)
      setConnectionState({ status: 'error', kind: 'protocol', message })
      socketRef.current?.close(1008, 'Protocol error')
    }

    const connect = (): void => {
      if (disposed) return
      setConnectionState({ status: 'connecting' })
      let authenticated = false

      let socket: WebSocket
      try {
        socket = new WebSocket(connectionUrl)
      } catch {
        scheduleReconnect()
        return
      }
      socketRef.current = socket

      socket.onopen = () => {
        if (disposed) return
        socket.send(JSON.stringify({ type: 'authenticate', pairingCode: pairingCode.trim() }))
      }

      socket.onmessage = (message) => {
        if (disposed || typeof message.data !== 'string') {
          if (!disposed) failProtocol('收到不符合协议的同步事件')
          return
        }

        let input: unknown
        try {
          input = JSON.parse(message.data)
        } catch {
          failProtocol('收到无法解析的同步事件')
          return
        }

        if (!authenticated) {
          if (!syncAuthAckSchema.safeParse(input).success) {
            failProtocol('同步服务认证失败')
            return
          }
          authenticated = true
          if (stabilityTimer) clearTimeout(stabilityTimer)
          stabilityTimer = setTimeout(() => {
            retryAttempt = 0
            stabilityTimer = null
          }, STABLE_CONNECTION_MS)
          setConnectionState({ status: 'connected' })
          return
        }

        const parsedControl = parseSyncControlMessage(input)
        if (parsedControl.success) {
          if (lastCommandIdRef.current !== parsedControl.data.commandId) {
            lastCommandIdRef.current = parsedControl.data.commandId
            setScrollCommand({
              commandId: parsedControl.data.commandId,
              direction: parsedControl.data.payload.direction
            })
          }
          return
        }

        const parsedEvent = parseSyncEvent(input)
        if (!parsedEvent.success) {
          failProtocol('收到不符合协议的同步事件')
          return
        }

        const nextState = sessionReducer(sessionRef.current, {
          type: 'event.received',
          payload: parsedEvent.data
        })
        sessionRef.current = nextState
        setSessionState(nextState)
        if (nextState.protocolError) failProtocol(nextState.protocolError)
      }

      socket.onclose = () => {
        if (stabilityTimer) {
          clearTimeout(stabilityTimer)
          stabilityTimer = null
        }
        if (socketRef.current === socket) socketRef.current = null
        scheduleReconnect()
      }
    }

    connect()

    return () => {
      disposed = true
      if (retryTimer) clearTimeout(retryTimer)
      if (stabilityTimer) clearTimeout(stabilityTimer)
      if (socketRef.current) {
        const socket = socketRef.current
        socketRef.current = null
        socket.close()
      }
    }
  }, [pairingCode, reconnectToken, serverUrl])

  return { connectionState, sessionState, scrollCommand, reconnect }
}
