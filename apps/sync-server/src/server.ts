import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import type { AddressInfo } from 'node:net'

import {
  MOBILE_PAIRING_CODE_DERIVATION_CONTEXT,
  SYNC_PROTOCOL_VERSION,
  mobilePairingCodeSchema,
  parseSyncAuthMessage,
  parseSyncControlMessage,
  parseSyncEvent,
  type SyncEvent
} from '@interview-coder/sync-protocol'
import WebSocket, { WebSocketServer } from 'ws'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_MAX_PAYLOAD_BYTES = 3 * 1024 * 1024
const DEFAULT_MAX_BUFFERED_AMOUNT_BYTES = 256 * 1024
const DEFAULT_MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000
const DEFAULT_AUTH_TIMEOUT_MS = 5_000
const DEFAULT_MAX_CONNECTIONS = 2_000
const DEFAULT_MAX_PENDING_AUTH = 100
const DEFAULT_MAX_ROOMS = 1_000
const DEFAULT_MAX_MOBILES_PER_ROOM = 5
// A single source (IP) must not be able to open enough sockets to exhaust the
// global room/connection budget on its own.
const DEFAULT_MAX_CONNECTIONS_PER_SOURCE = 20
// Global ceiling on retained snapshot memory across all rooms, independent of the
// per-room limit, so maxRooms * maxSnapshotBytes cannot balloon unbounded.
const DEFAULT_MAX_TOTAL_SNAPSHOT_BYTES = 64 * 1024 * 1024

type ClientRole = 'desktop' | 'mobile'
type RequestStatus = 'idle' | 'loading' | 'completed' | 'stopped' | 'failed'
type TrackedSocket = WebSocket & { isAlive?: boolean }

type RoomSnapshot = {
  sessionId: string
  seq: number
  lastEventId: string
  solution: string
  screenshotTotal: number
  requestStatus: RequestStatus
  errorMessage: string | null
}

type Room = {
  desktop: WebSocket | null
  mobiles: Set<WebSocket>
  snapshot: RoomSnapshot | null
  snapshotBytes: number
}

export type SyncServerOptions = {
  port: number
  host?: string
  maxPayloadBytes?: number
  maxBufferedAmountBytes?: number
  maxSnapshotBytes?: number
  heartbeatIntervalMs?: number
  authTimeoutMs?: number
  maxConnections?: number
  maxPendingAuth?: number
  maxRooms?: number
  maxMobilesPerRoom?: number
  maxConnectionsPerSource?: number
  maxTotalSnapshotBytes?: number
}

export type SyncServer = {
  readonly ready: Promise<void>
  readonly url: string
  close(): Promise<void>
}

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`)
  }
}

function parseConnectionRole(
  requestUrl: string | undefined,
  host: string | undefined
): ClientRole | null {
  if (!requestUrl) return null

  let url: URL
  try {
    url = new URL(requestUrl, `http://${host ?? 'localhost'}`)
  } catch {
    return null
  }

  const roles = url.searchParams.getAll('role')
  if (roles.length !== 1 || [...url.searchParams.keys()].some((key) => key !== 'role')) return null
  return roles[0] === 'desktop' || roles[0] === 'mobile' ? roles[0] : null
}

function rejectUpgrade(socket: NodeJS.WritableStream, statusCode = 400): void {
  const statusText = statusCode === 503 ? 'Service Unavailable' : 'Bad Request'
  socket.write(
    `HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
  )
  if ('destroy' in socket && typeof socket.destroy === 'function') socket.destroy()
}

function closeWithPolicyViolation(socket: WebSocket, reason = 'Invalid client message'): void {
  if (socket.readyState === WebSocket.OPEN) socket.close(1008, reason)
}

function deriveMobilePairingCode(desktopSecret: string): string {
  return createHash('sha256')
    .update(`${MOBILE_PAIRING_CODE_DERIVATION_CONTEXT}${desktopSecret}`)
    .digest('hex')
}

function updateSnapshot(current: RoomSnapshot | null, event: SyncEvent): RoomSnapshot | null {
  if (event.type === 'session.snapshot') {
    if (current && current.sessionId === event.sessionId && event.seq < current.seq) return null
    return {
      sessionId: event.sessionId,
      seq: event.seq,
      lastEventId: event.eventId,
      ...event.payload
    }
  }

  if (event.type === 'session.reset') {
    return {
      sessionId: event.sessionId,
      seq: event.seq,
      lastEventId: event.eventId,
      solution: '',
      screenshotTotal: 0,
      requestStatus: 'idle',
      errorMessage: null
    }
  }

  if (!current || current.sessionId !== event.sessionId || event.seq <= current.seq) return null
  const next = { ...current, seq: event.seq, lastEventId: event.eventId }
  switch (event.type) {
    case 'screenshot.updated':
      next.screenshotTotal = event.payload.total
      break
    case 'request.started':
      next.requestStatus = 'loading'
      next.errorMessage = null
      break
    case 'solution.delta':
      next.solution += event.payload.text
      break
    case 'request.completed':
      next.requestStatus = 'completed'
      break
    case 'request.stopped':
      next.requestStatus = 'stopped'
      break
    case 'request.failed':
      next.requestStatus = 'failed'
      next.errorMessage = event.payload.message
      break
  }
  return next
}

function createSnapshotEvent(snapshot: RoomSnapshot): SyncEvent {
  return {
    version: SYNC_PROTOCOL_VERSION,
    eventId: `snapshot-${snapshot.lastEventId}`,
    sessionId: snapshot.sessionId,
    seq: snapshot.seq,
    timestamp: Date.now(),
    type: 'session.snapshot',
    payload: {
      solution: snapshot.solution,
      screenshotTotal: snapshot.screenshotTotal,
      requestStatus: snapshot.requestStatus,
      errorMessage: snapshot.errorMessage
    }
  }
}

function closeServer(server: { close(callback: (error?: Error) => void): void }): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (!error || (error as NodeJS.ErrnoException).code === 'ERR_SERVER_NOT_RUNNING') resolve()
      else reject(error)
    })
  })
}

export function createSyncServer(options: SyncServerOptions): SyncServer {
  if (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw new TypeError('port must be an integer between 0 and 65535')
  }

  const maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES
  const maxBufferedAmountBytes = options.maxBufferedAmountBytes ?? DEFAULT_MAX_BUFFERED_AMOUNT_BYTES
  const maxSnapshotBytes = options.maxSnapshotBytes ?? DEFAULT_MAX_SNAPSHOT_BYTES
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
  const authTimeoutMs = options.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS
  const maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS
  const maxPendingAuth = options.maxPendingAuth ?? DEFAULT_MAX_PENDING_AUTH
  const maxRooms = options.maxRooms ?? DEFAULT_MAX_ROOMS
  const maxMobilesPerRoom = options.maxMobilesPerRoom ?? DEFAULT_MAX_MOBILES_PER_ROOM
  const maxConnectionsPerSource =
    options.maxConnectionsPerSource ?? DEFAULT_MAX_CONNECTIONS_PER_SOURCE
  const maxTotalSnapshotBytes = options.maxTotalSnapshotBytes ?? DEFAULT_MAX_TOTAL_SNAPSHOT_BYTES
  for (const [name, value] of Object.entries({
    maxPayloadBytes,
    maxBufferedAmountBytes,
    maxSnapshotBytes,
    heartbeatIntervalMs,
    authTimeoutMs,
    maxConnections,
    maxPendingAuth,
    maxRooms,
    maxMobilesPerRoom,
    maxConnectionsPerSource,
    maxTotalSnapshotBytes
  })) {
    requirePositiveInteger(value, name)
  }

  const host = options.host ?? DEFAULT_HOST
  const rooms = new Map<string, Room>()
  const pendingAuth = new Set<WebSocket>()
  // Live socket count per source IP, used to bound how much any single client can consume.
  const connectionsPerSource = new Map<string, number>()
  let totalSnapshotBytes = 0
  const httpServer = createServer((_request, response) => response.writeHead(404).end())
  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: maxPayloadBytes })
  let listeningUrl: string | undefined
  let closePromise: Promise<void> | undefined

  function sendFrame(socket: WebSocket, frame: string): void {
    if (socket.bufferedAmount > maxBufferedAmountBytes) {
      socket.terminate()
      return
    }
    socket.send(frame)
  }

  function attachClient(socket: WebSocket, role: ClientRole, pairingCode: string): void {
    if (role === 'mobile' && !mobilePairingCodeSchema.safeParse(pairingCode).success) {
      closeWithPolicyViolation(socket, 'Invalid mobile pairing code')
      return
    }

    const roomId = role === 'desktop' ? deriveMobilePairingCode(pairingCode) : pairingCode
    let room = rooms.get(roomId)
    if (role === 'desktop') {
      if (room?.desktop?.readyState === WebSocket.OPEN) {
        closeWithPolicyViolation(socket, 'Desktop already connected')
        return
      }
      if (!room) {
        if (rooms.size >= maxRooms) {
          closeWithPolicyViolation(socket, 'Room capacity reached')
          return
        }
        room = { desktop: null, mobiles: new Set(), snapshot: null, snapshotBytes: 0 }
        rooms.set(roomId, room)
      }
      room.desktop = socket
    } else {
      if (!room?.desktop || room.desktop.readyState !== WebSocket.OPEN) {
        closeWithPolicyViolation(socket, 'Desktop unavailable')
        return
      }
      if (room.mobiles.size >= maxMobilesPerRoom) {
        closeWithPolicyViolation(socket, 'Mobile capacity reached')
        return
      }
    }

    sendFrame(socket, JSON.stringify({ type: 'authenticated' }))
    if (role === 'mobile' && room.snapshot) {
      const snapshot = JSON.stringify(createSnapshotEvent(room.snapshot))
      sendFrame(socket, snapshot)
    }
    if (role === 'mobile') room.mobiles.add(socket)

    socket.on('close', () => {
      if (role === 'desktop' && room.desktop === socket) room.desktop = null
      if (role === 'mobile') room.mobiles.delete(socket)
      if (!room.desktop && room.mobiles.size === 0) {
        totalSnapshotBytes -= room.snapshotBytes
        rooms.delete(roomId)
      }
    })

    socket.on('message', (data, isBinary) => {
      if (role !== 'desktop' || isBinary) {
        closeWithPolicyViolation(socket)
        return
      }

      let input: unknown
      try {
        input = JSON.parse(data.toString())
      } catch {
        closeWithPolicyViolation(socket)
        return
      }

      const parsedControl = parseSyncControlMessage(input)
      if (parsedControl.success) {
        const serializedControl = JSON.stringify(parsedControl.data)
        for (const mobile of room.mobiles) {
          if (mobile.readyState === WebSocket.OPEN) sendFrame(mobile, serializedControl)
        }
        return
      }

      const parsedEvent = parseSyncEvent(input)
      if (!parsedEvent.success) {
        closeWithPolicyViolation(socket)
        return
      }

      const nextSnapshot = updateSnapshot(room.snapshot, parsedEvent.data)
      if (!nextSnapshot) {
        closeWithPolicyViolation(socket, 'Invalid event sequence')
        return
      }
      const serializedSnapshot = JSON.stringify(createSnapshotEvent(nextSnapshot))
      const nextSnapshotBytes = Buffer.byteLength(serializedSnapshot)
      if (nextSnapshotBytes > maxSnapshotBytes) {
        closeWithPolicyViolation(socket, 'Session snapshot is too large')
        return
      }
      if (totalSnapshotBytes - room.snapshotBytes + nextSnapshotBytes > maxTotalSnapshotBytes) {
        closeWithPolicyViolation(socket, 'Server snapshot memory budget reached')
        return
      }
      totalSnapshotBytes += nextSnapshotBytes - room.snapshotBytes
      room.snapshot = nextSnapshot
      room.snapshotBytes = nextSnapshotBytes

      const serializedEvent = JSON.stringify(parsedEvent.data)
      for (const mobile of room.mobiles) {
        if (mobile.readyState === WebSocket.OPEN) sendFrame(mobile, serializedEvent)
      }
    })
  }

  function authenticateClient(socket: WebSocket, role: ClientRole): void {
    const trackedSocket = socket as TrackedSocket
    trackedSocket.isAlive = true
    socket.on('pong', () => {
      trackedSocket.isAlive = true
    })
    socket.on('error', () => undefined)
    pendingAuth.add(socket)

    const authTimer = setTimeout(
      () => closeWithPolicyViolation(socket, 'Authentication timeout'),
      authTimeoutMs
    )
    authTimer.unref()
    const cleanupPending = (): void => {
      clearTimeout(authTimer)
      pendingAuth.delete(socket)
    }
    socket.once('close', cleanupPending)
    socket.once('message', (data, isBinary) => {
      cleanupPending()
      if (isBinary) {
        closeWithPolicyViolation(socket, 'Invalid authentication')
        return
      }
      let input: unknown
      try {
        input = JSON.parse(data.toString())
      } catch {
        closeWithPolicyViolation(socket, 'Invalid authentication')
        return
      }
      const parsedAuth = parseSyncAuthMessage(input)
      if (!parsedAuth.success) {
        closeWithPolicyViolation(socket, 'Invalid authentication')
        return
      }
      attachClient(socket, role, parsedAuth.data.pairingCode)
    })
  }

  httpServer.on('upgrade', (request, socket, head) => {
    const role = parseConnectionRole(request.url, request.headers.host)
    if (!role) {
      rejectUpgrade(socket)
      return
    }
    if (webSocketServer.clients.size >= maxConnections || pendingAuth.size >= maxPendingAuth) {
      rejectUpgrade(socket, 503)
      return
    }
    // Bound per-source sockets so one IP cannot exhaust rooms/connections alone.
    const source = request.socket.remoteAddress ?? 'unknown'
    if ((connectionsPerSource.get(source) ?? 0) >= maxConnectionsPerSource) {
      rejectUpgrade(socket, 503)
      return
    }
    connectionsPerSource.set(source, (connectionsPerSource.get(source) ?? 0) + 1)
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocket.once('close', () => {
        const remaining = (connectionsPerSource.get(source) ?? 1) - 1
        if (remaining <= 0) connectionsPerSource.delete(source)
        else connectionsPerSource.set(source, remaining)
      })
      authenticateClient(webSocket, role)
    })
  })

  const heartbeat = setInterval(() => {
    for (const socket of webSocketServer.clients as Set<TrackedSocket>) {
      if (socket.isAlive === false) {
        socket.terminate()
        continue
      }
      socket.isAlive = false
      socket.ping()
    }
  }, heartbeatIntervalMs)
  heartbeat.unref()

  const ready = new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error)
    httpServer.once('error', onError)
    httpServer.listen(options.port, host, () => {
      httpServer.off('error', onError)
      const address = httpServer.address() as AddressInfo
      const urlHost = address.address.includes(':') ? `[${address.address}]` : address.address
      listeningUrl = `ws://${urlHost}:${address.port}`
      resolve()
    })
  })

  return {
    ready,
    get url() {
      if (!listeningUrl) throw new Error('Sync server is not ready')
      return listeningUrl
    },
    close() {
      if (closePromise) return closePromise
      clearInterval(heartbeat)
      for (const client of webSocketServer.clients) client.terminate()
      rooms.clear()
      pendingAuth.clear()
      connectionsPerSource.clear()
      totalSnapshotBytes = 0
      closePromise = ready
        .catch(() => undefined)
        .then(() =>
          Promise.all([closeServer(webSocketServer), closeServer(httpServer)]).then(() => undefined)
        )
      return closePromise
    }
  }
}
