import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import {
  MOBILE_PAIRING_CODE_DERIVATION_CONTEXT,
  type SyncControlMessage,
  type SyncEvent
} from '@interview-coder/sync-protocol'
import WebSocket from 'ws'
import { afterEach, describe, expect, it } from 'vitest'

import { createSyncServer, type SyncServer } from './server'

const TEST_TIMEOUT_MS = 5_000

function deriveMobilePairingCode(desktopSecret: string): string {
  return createHash('sha256')
    .update(`${MOBILE_PAIRING_CODE_DERIVATION_CONTEXT}${desktopSecret}`)
    .digest('hex')
}

function createEvent(seq: number, type: SyncEvent['type'] = 'solution.delta'): SyncEvent {
  const envelope = {
    version: 1 as const,
    eventId: `event-${seq}`,
    sessionId: 'session-1',
    seq,
    timestamp: 1_725_000_000_000 + seq
  }
  if (type === 'session.reset') return { ...envelope, type, payload: {} }
  return { ...envelope, type: 'solution.delta', payload: { text: `chunk-${seq}` } }
}

function createScrollCommand(
  direction: SyncControlMessage['payload']['direction'] = 'down'
): SyncControlMessage {
  return {
    version: 1,
    type: 'control.scroll',
    commandId: `command-${direction}`,
    timestamp: 1_725_000_000_000,
    payload: { direction }
  }
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
}

function waitForClose(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => socket.once('close', (code) => resolve(code)))
}

function collectMessages(socket: WebSocket, count: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const messages: string[] = []
    const timeout = setTimeout(
      () => reject(new Error('Timed out waiting for messages')),
      TEST_TIMEOUT_MS
    )
    socket.on('message', (data) => {
      messages.push(data.toString())
      if (messages.length === count) {
        clearTimeout(timeout)
        resolve(messages)
      }
    })
  })
}

function expectNoMessage(socket: WebSocket, durationMs = 100): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = (): void => {
      clearTimeout(timeout)
      reject(new Error('Received an unexpected message'))
    }
    const timeout = setTimeout(() => {
      socket.off('message', onMessage)
      resolve()
    }, durationMs)
    socket.once('message', onMessage)
  })
}

describe('createSyncServer', () => {
  const servers: SyncServer[] = []
  const sockets = new Set<WebSocket>()

  async function startServer(
    options: {
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
    } = {}
  ): Promise<SyncServer> {
    const server = createSyncServer({ port: 0, ...options })
    servers.push(server)
    await server.ready
    return server
  }

  async function connect(
    server: SyncServer,
    role: 'desktop' | 'mobile',
    pairingCode: string
  ): Promise<WebSocket> {
    const socket = await connectSocket(server, role)
    const authenticated = collectMessages(socket, 1)
    socket.send(
      JSON.stringify({
        type: 'authenticate',
        pairingCode: role === 'mobile' ? deriveMobilePairingCode(pairingCode) : pairingCode
      })
    )
    expect(JSON.parse((await authenticated)[0])).toEqual({ type: 'authenticated' })
    return socket
  }

  async function connectSocket(server: SyncServer, role: 'desktop' | 'mobile'): Promise<WebSocket> {
    const url = new URL(server.url)
    url.searchParams.set('role', role)
    const socket = new WebSocket(url)
    sockets.add(socket)
    await waitForOpen(socket)
    return socket
  }

  afterEach(async () => {
    for (const socket of sockets) socket.terminate()
    sockets.clear()
    await Promise.all(servers.splice(0).map((server) => server.close()))
  })

  it('forwards ordered desktop events only to mobile clients in the same room', async () => {
    const server = await startServer()
    const desktop = await connect(server, 'desktop', '0123456789abcdef0123456789abcdef')
    const mobile = await connect(server, 'mobile', '0123456789abcdef0123456789abcdef')
    const received = collectMessages(mobile, 2)

    desktop.send(JSON.stringify(createEvent(1, 'session.reset')))
    desktop.send(JSON.stringify(createEvent(2)))

    expect((await received).map((message) => JSON.parse(message))).toEqual([
      createEvent(1, 'session.reset'),
      createEvent(2)
    ])
  })

  it('broadcasts scroll commands to every mobile in the matching room', async () => {
    const server = await startServer()
    const desktop = await connect(server, 'desktop', 'room01room01abcdroom01room01abcd')
    const firstMobile = await connect(server, 'mobile', 'room01room01abcdroom01room01abcd')
    const secondMobile = await connect(server, 'mobile', 'room01room01abcdroom01room01abcd')
    await connect(server, 'desktop', 'room02room02abcdroom02room02abcd')
    const otherRoomMobile = await connect(server, 'mobile', 'room02room02abcdroom02room02abcd')
    const firstReceived = collectMessages(firstMobile, 1)
    const secondReceived = collectMessages(secondMobile, 1)
    const otherRoomReceivesNothing = expectNoMessage(otherRoomMobile)
    const command = createScrollCommand('down')

    desktop.send(JSON.stringify(command))

    expect(JSON.parse((await firstReceived)[0])).toEqual(command)
    expect(JSON.parse((await secondReceived)[0])).toEqual(command)
    await expect(otherRoomReceivesNothing).resolves.toBeUndefined()
  })

  it('does not persist or replay scroll commands', async () => {
    const desktopSecret = '0123456789abcdef0123456789abcdef'
    const server = await startServer()
    const desktop = await connect(server, 'desktop', desktopSecret)
    const witness = await connect(server, 'mobile', desktopSecret)
    const initialEvent = collectMessages(witness, 1)
    desktop.send(JSON.stringify(createEvent(1, 'session.reset')))
    await initialEvent
    const liveCommand = collectMessages(witness, 1)
    desktop.send(JSON.stringify(createScrollCommand('up')))
    expect(JSON.parse((await liveCommand)[0])).toEqual(createScrollCommand('up'))

    const observer = await connectSocket(server, 'mobile')
    const replayed = collectMessages(observer, 2)
    observer.send(
      JSON.stringify({
        type: 'authenticate',
        pairingCode: deriveMobilePairingCode(desktopSecret)
      })
    )
    const [acknowledgement, snapshotMessage] = await replayed
    expect(JSON.parse(acknowledgement)).toEqual({ type: 'authenticated' })
    const snapshot = JSON.parse(snapshotMessage) as SyncEvent
    expect(snapshot.type).toBe('session.snapshot')
    expect(snapshot.seq).toBe(1)
    await expect(expectNoMessage(observer)).resolves.toBeUndefined()
  })

  it('closes a desktop that sends an invalid scroll command', async () => {
    const server = await startServer()
    const desktop = await connect(server, 'desktop', '0123456789abcdef0123456789abcdef')
    const closed = waitForClose(desktop)

    desktop.send(
      JSON.stringify({
        ...createScrollCommand(),
        payload: { direction: 'left' }
      })
    )

    await expect(closed).resolves.toBe(1008)
  })

  it.each([
    ['missing role', ''],
    ['unsupported role', '?role=viewer'],
    ['duplicate role', '?role=desktop&role=mobile'],
    ['unknown parameter', '?role=desktop&extra=1']
  ])('rejects a connection with %s', async (_caseName, query) => {
    const server = await startServer()
    const socket = new WebSocket(`${server.url}${query}`)
    sockets.add(socket)
    const statusCode = await new Promise<number>((resolve, reject) => {
      socket.once('unexpected-response', (_request, response) => {
        response.statusCode === undefined
          ? reject(new Error('Upgrade rejection did not include an HTTP status'))
          : resolve(response.statusCode)
      })
      socket.once('open', () => reject(new Error('Invalid connection was accepted')))
      socket.once('error', () => undefined)
    })
    expect(statusCode).toBe(400)
  })

  it('allows only one desktop producer per room', async () => {
    const server = await startServer()
    await connect(server, 'desktop', '0123456789abcdef0123456789abcdef')
    const duplicate = await connectSocket(server, 'desktop')
    const closed = waitForClose(duplicate)
    duplicate.send(
      JSON.stringify({
        type: 'authenticate',
        pairingCode: '0123456789abcdef0123456789abcdef'
      })
    )
    await expect(closed).resolves.toBe(1008)
  })

  it('does not let a mobile pairing code impersonate the desktop producer', async () => {
    const desktopSecret = '0123456789abcdef0123456789abcdef'
    const mobilePairingCode = deriveMobilePairingCode(desktopSecret)
    const server = await startServer()
    const desktop = await connect(server, 'desktop', desktopSecret)
    const mobile = await connect(server, 'mobile', desktopSecret)

    const desktopClosed = waitForClose(desktop)
    desktop.close()
    await desktopClosed

    const attacker = await connectSocket(server, 'desktop')
    const attackerAuthenticated = collectMessages(attacker, 1)
    attacker.send(JSON.stringify({ type: 'authenticate', pairingCode: mobilePairingCode }))
    expect(JSON.parse((await attackerAuthenticated)[0])).toEqual({ type: 'authenticated' })

    const receivesNothing = expectNoMessage(mobile)
    attacker.send(JSON.stringify(createEvent(1, 'session.reset')))
    await expect(receivesNothing).resolves.toBeUndefined()

    const reconnectedDesktop = await connect(server, 'desktop', desktopSecret)
    const received = collectMessages(mobile, 1)
    reconnectedDesktop.send(JSON.stringify(createEvent(1, 'session.reset')))
    expect(JSON.parse((await received)[0])).toEqual(createEvent(1, 'session.reset'))
  })

  it('does not create a room for a mobile client without a desktop', async () => {
    const server = await startServer()
    const mobile = await connectSocket(server, 'mobile')
    const closed = waitForClose(mobile)
    mobile.send(
      JSON.stringify({
        type: 'authenticate',
        pairingCode: deriveMobilePairingCode('0123456789abcdef0123456789abcdef')
      })
    )
    await expect(closed).resolves.toBe(1008)
  })

  it('closes clients that do not authenticate in time', async () => {
    const server = await startServer({ authTimeoutMs: 20 })
    const socket = await connectSocket(server, 'desktop')
    await expect(waitForClose(socket)).resolves.toBe(1008)
  })

  it('rejects an invalid or out-of-order sync event', async () => {
    const server = await startServer()
    const desktop = await connect(server, 'desktop', '0123456789abcdef0123456789abcdef')
    desktop.send(JSON.stringify(createEvent(1, 'session.reset')))
    desktop.send(JSON.stringify(createEvent(2)))
    const closed = waitForClose(desktop)
    desktop.send(JSON.stringify(createEvent(2)))
    await expect(closed).resolves.toBe(1008)
  })

  it('replays a complete aggregated snapshot to a later mobile client', async () => {
    const server = await startServer()
    const desktop = await connect(server, 'desktop', '0123456789abcdef0123456789abcdef')
    const witness = await connect(server, 'mobile', '0123456789abcdef0123456789abcdef')
    const witnessed = collectMessages(witness, 110)
    desktop.send(JSON.stringify(createEvent(1, 'session.reset')))
    desktop.send(
      JSON.stringify({
        ...createEvent(2),
        type: 'screenshot.updated',
        payload: { total: 3 }
      })
    )
    desktop.send(JSON.stringify({ ...createEvent(3), type: 'request.started', payload: {} }))
    for (let seq = 4; seq <= 109; seq += 1) desktop.send(JSON.stringify(createEvent(seq)))
    desktop.send(
      JSON.stringify({
        ...createEvent(110),
        type: 'request.failed',
        payload: { message: '上游连接失败' }
      })
    )
    await witnessed

    const observer = await connectSocket(server, 'mobile')
    const replayed = collectMessages(observer, 2)
    observer.send(
      JSON.stringify({
        type: 'authenticate',
        pairingCode: deriveMobilePairingCode('0123456789abcdef0123456789abcdef')
      })
    )
    const [, message] = await replayed
    const snapshot = JSON.parse(message) as SyncEvent
    expect(snapshot.type).toBe('session.snapshot')
    if (snapshot.type === 'session.snapshot') {
      expect(snapshot.seq).toBe(110)
      expect(snapshot.payload.solution).toContain('chunk-4')
      expect(snapshot.payload.solution).toContain('chunk-109')
      expect(snapshot.payload.screenshotTotal).toBe(3)
      expect(snapshot.payload.requestStatus).toBe('failed')
      expect(snapshot.payload.errorMessage).toBe('上游连接失败')
    }
  })

  it('sends the snapshot before live events to a newly authenticated mobile', async () => {
    const desktopSecret = '0123456789abcdef0123456789abcdef'
    const server = await startServer()
    const desktop = await connect(server, 'desktop', desktopSecret)
    desktop.send(JSON.stringify(createEvent(1, 'session.reset')))
    desktop.send(JSON.stringify(createEvent(2)))
    await new Promise((resolve) => setTimeout(resolve, 10))

    const observer = await connectSocket(server, 'mobile')
    const frames = new Promise<SyncEvent[]>((resolve, reject) => {
      const received: unknown[] = []
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for frames')), 5_000)
      observer.on('message', (data) => {
        const frame = JSON.parse(data.toString()) as unknown
        received.push(frame)
        if (received.length === 1) desktop.send(JSON.stringify(createEvent(3)))
        if (received.length === 3) {
          clearTimeout(timeout)
          resolve(received.slice(1) as SyncEvent[])
        }
      })
    })
    observer.send(
      JSON.stringify({
        type: 'authenticate',
        pairingCode: deriveMobilePairingCode(desktopSecret)
      })
    )

    const [snapshot, liveEvent] = await frames
    expect(snapshot.type).toBe('session.snapshot')
    expect(snapshot.seq).toBe(2)
    expect(liveEvent).toEqual(createEvent(3))
  })

  it('accepts a desktop snapshot after reconnecting and continues from its sequence', async () => {
    const server = await startServer()
    const desktop = await connect(server, 'desktop', '0123456789abcdef0123456789abcdef')
    const mobile = await connect(server, 'mobile', '0123456789abcdef0123456789abcdef')
    const initialEvents = collectMessages(mobile, 2)
    desktop.send(JSON.stringify(createEvent(1, 'session.reset')))
    desktop.send(JSON.stringify(createEvent(2)))
    await initialEvents

    const desktopClosed = waitForClose(desktop)
    desktop.close()
    await desktopClosed

    const reconnectedDesktop = await connect(server, 'desktop', '0123456789abcdef0123456789abcdef')
    const recoveredEvents = collectMessages(mobile, 2)
    reconnectedDesktop.send(
      JSON.stringify({
        ...createEvent(2),
        eventId: 'snapshot-event-2',
        type: 'session.snapshot',
        payload: {
          solution: 'chunk-2',
          screenshotTotal: 1,
          requestStatus: 'completed',
          errorMessage: null
        }
      })
    )
    reconnectedDesktop.send(JSON.stringify(createEvent(3)))

    const [recoveryMessage, nextMessage] = (await recoveredEvents).map(
      (message) => JSON.parse(message) as SyncEvent
    )
    expect(recoveryMessage.type).toBe('session.snapshot')
    expect(nextMessage).toEqual(createEvent(3))
  })

  it('keeps events isolated by pairing code', async () => {
    const server = await startServer()
    const desktop = await connect(server, 'desktop', 'room01room01abcdroom01room01abcd')
    const matchingMobile = await connect(server, 'mobile', 'room01room01abcdroom01room01abcd')
    await connect(server, 'desktop', 'room02room02abcdroom02room02abcd')
    const otherMobile = await connect(server, 'mobile', 'room02room02abcdroom02room02abcd')
    const matchingMessage = collectMessages(matchingMobile, 1)
    const otherRoomReceivesNothing = expectNoMessage(otherMobile)

    desktop.send(JSON.stringify(createEvent(1, 'session.reset')))

    expect(JSON.parse((await matchingMessage)[0])).toEqual(createEvent(1, 'session.reset'))
    await expect(otherRoomReceivesNothing).resolves.toBeUndefined()
  })

  it('enforces the configured maximum payload size', async () => {
    const server = await startServer({ maxPayloadBytes: 128 })
    const desktop = await connect(server, 'desktop', '0123456789abcdef0123456789abcdef')
    const closed = waitForClose(desktop)
    desktop.send('x'.repeat(129))
    await expect(closed).resolves.toBe(1009)
  })

  it('closes a desktop whose aggregated snapshot exceeds the configured limit', async () => {
    const server = await startServer({ maxSnapshotBytes: 500 })
    const desktop = await connect(server, 'desktop', '0123456789abcdef0123456789abcdef')
    desktop.send(JSON.stringify(createEvent(1, 'session.reset')))
    const closed = waitForClose(desktop)
    desktop.send(
      JSON.stringify({
        ...createEvent(2),
        payload: { text: 'x'.repeat(1_000) }
      })
    )
    await expect(closed).resolves.toBe(1008)
  })

  it('replays one snapshot larger than the slow-client backlog threshold', async () => {
    const server = await startServer({
      maxBufferedAmountBytes: 128 * 1024,
      maxSnapshotBytes: 400 * 1024
    })
    const desktop = await connect(server, 'desktop', '0123456789abcdef0123456789abcdef')
    const witness = await connect(server, 'mobile', '0123456789abcdef0123456789abcdef')
    const witnessed = collectMessages(witness, 11)
    desktop.send(JSON.stringify(createEvent(1, 'session.reset')))
    for (let seq = 2; seq <= 11; seq += 1) {
      desktop.send(
        JSON.stringify({
          ...createEvent(seq),
          payload: { text: 'x'.repeat(30 * 1024) }
        })
      )
    }
    await witnessed

    const observer = await connectSocket(server, 'mobile')
    const replayed = collectMessages(observer, 2)
    observer.send(
      JSON.stringify({
        type: 'authenticate',
        pairingCode: deriveMobilePairingCode('0123456789abcdef0123456789abcdef')
      })
    )
    const [, snapshotMessage] = await replayed
    const snapshot = JSON.parse(snapshotMessage) as SyncEvent
    expect(snapshot.type).toBe('session.snapshot')
    if (snapshot.type === 'session.snapshot') {
      expect(Buffer.byteLength(snapshot.payload.solution)).toBe(300 * 1024)
    }
  })

  it('discards the snapshot after the last client disconnects', async () => {
    const server = await startServer()
    const desktop = await connect(server, 'desktop', '0123456789abcdef0123456789abcdef')
    const observer = await connect(server, 'mobile', '0123456789abcdef0123456789abcdef')
    const observed = collectMessages(observer, 1)
    desktop.send(JSON.stringify(createEvent(1, 'session.reset')))
    await observed
    const desktopClosed = waitForClose(desktop)
    const observerClosed = waitForClose(observer)
    desktop.close()
    observer.close()
    await Promise.all([desktopClosed, observerClosed])

    const lateMobile = await connectSocket(server, 'mobile')
    const closed = waitForClose(lateMobile)
    lateMobile.send(
      JSON.stringify({
        type: 'authenticate',
        pairingCode: deriveMobilePairingCode('0123456789abcdef0123456789abcdef')
      })
    )
    await expect(closed).resolves.toBe(1008)
  })

  it('rejects connections beyond the per-source limit', async () => {
    const server = await startServer({ maxConnectionsPerSource: 1 })
    const first = await connectSocket(server, 'desktop')
    expect(first.readyState).toBe(WebSocket.OPEN)

    const url = new URL(server.url)
    url.searchParams.set('role', 'desktop')
    const second = new WebSocket(url)
    sockets.add(second)
    const statusCode = await new Promise<number>((resolve, reject) => {
      second.once('unexpected-response', (_request, response) => {
        response.statusCode === undefined
          ? reject(new Error('Upgrade rejection did not include an HTTP status'))
          : resolve(response.statusCode)
      })
      second.once('open', () => reject(new Error('Over-limit connection was accepted')))
      second.once('error', () => undefined)
    })
    expect(statusCode).toBe(503)
  })

  it('closes a desktop when the global snapshot memory budget is exceeded', async () => {
    const server = await startServer({ maxTotalSnapshotBytes: 400, maxSnapshotBytes: 100_000 })
    const desktop = await connect(server, 'desktop', '0123456789abcdef0123456789abcdef')
    desktop.send(JSON.stringify(createEvent(1, 'session.reset')))
    const closed = waitForClose(desktop)
    desktop.send(
      JSON.stringify({
        ...createEvent(2),
        payload: { text: 'x'.repeat(1_000) }
      })
    )
    await expect(closed).resolves.toBe(1008)
  })

  it('can be closed cleanly after startup fails', async () => {
    const occupied = createServer()
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve))
    const address = occupied.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP address')

    const server = createSyncServer({ port: address.port })
    await expect(server.ready).rejects.toMatchObject({ code: 'EADDRINUSE' })
    await expect(server.close()).resolves.toBeUndefined()
    await new Promise<void>((resolve, reject) =>
      occupied.close((error) => (error ? reject(error) : resolve()))
    )
  })
})
