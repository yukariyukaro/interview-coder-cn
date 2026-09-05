import { randomUUID } from 'node:crypto'

import {
  SYNC_PROTOCOL_VERSION,
  parseSyncEvent,
  type SyncEvent,
  type SyncEventType
} from '@interview-coder/sync-protocol'

type PublishableEvent = Exclude<SyncEvent, { type: 'session.reset' } | { type: 'session.snapshot' }>
type PublishableEventType = PublishableEvent['type']
type EventFor<TType extends SyncEventType> = Extract<SyncEvent, { type: TType }>
type EventPayload<TType extends PublishableEventType> = EventFor<TType>['payload']
type EventSink = (event: SyncEvent) => void
type RequestStatus = EventFor<'session.snapshot'>['payload']['requestStatus']

type AggregateState = {
  solution: string
  screenshotTotal: number
  requestStatus: RequestStatus
  errorMessage: string | null
}

export type SolutionEventPublisherOptions = {
  createSessionId?: () => string
  createEventId?: () => string
  now?: () => number
}

export type SolutionEventPublisher = {
  resetSession(): EventFor<'session.reset'>
  publish<TType extends PublishableEventType>(
    type: TType,
    payload: EventPayload<TType>
  ): EventFor<TType>
  getSnapshot(): EventFor<'session.snapshot'>
  addSink(sink: EventSink): () => void
}

const createInitialState = (): AggregateState => ({
  solution: '',
  screenshotTotal: 0,
  requestStatus: 'idle',
  errorMessage: null
})

export function createSolutionEventPublisher(
  options: SolutionEventPublisherOptions = {}
): SolutionEventPublisher {
  const createSessionId = options.createSessionId ?? randomUUID
  const createEventId = options.createEventId ?? randomUUID
  const now = options.now ?? Date.now
  const sinks = new Set<EventSink>()
  let sessionId: string | null = null
  let seq = 0
  let aggregate = createInitialState()

  function ensureSession(): string {
    if (!sessionId) sessionId = createSessionId()
    return sessionId
  }

  function createEvent(type: SyncEventType, payload: unknown, eventSeq: number): SyncEvent {
    const parsed = parseSyncEvent({
      version: SYNC_PROTOCOL_VERSION,
      eventId: createEventId(),
      sessionId: ensureSession(),
      seq: eventSeq,
      timestamp: now(),
      type,
      payload
    })
    if (!parsed.success) {
      throw new TypeError(`Invalid sync event: ${parsed.error.message}`)
    }
    return parsed.data
  }

  function emit<TEvent extends SyncEvent>(event: TEvent): TEvent {
    for (const sink of sinks) {
      try {
        sink(event)
      } catch (error) {
        console.error('Solution event sink failed:', error)
      }
    }
    return event
  }

  return {
    resetSession() {
      sessionId = createSessionId()
      seq = 1
      aggregate = createInitialState()
      return emit(createEvent('session.reset', {}, seq) as EventFor<'session.reset'>)
    },

    publish(type, payload) {
      if (!sessionId) {
        throw new Error('Cannot publish a solution event before starting a session')
      }
      const nextSeq = seq + 1
      const event = createEvent(type, payload, nextSeq) as PublishableEvent
      seq = nextSeq
      switch (event.type) {
        case 'screenshot.updated':
          aggregate.screenshotTotal = event.payload.total
          break
        case 'request.started':
          aggregate.requestStatus = 'loading'
          aggregate.errorMessage = null
          break
        case 'solution.delta':
          aggregate.solution += event.payload.text
          break
        case 'request.completed':
          aggregate.requestStatus = 'completed'
          break
        case 'request.stopped':
          aggregate.requestStatus = 'stopped'
          break
        case 'request.failed':
          aggregate.requestStatus = 'failed'
          aggregate.errorMessage = event.payload.message
          break
      }
      return emit(event) as EventFor<typeof type>
    },

    getSnapshot() {
      ensureSession()
      if (seq === 0) seq = 1
      return createEvent('session.snapshot', { ...aggregate }, seq) as EventFor<'session.snapshot'>
    },

    addSink(sink) {
      sinks.add(sink)
      return () => sinks.delete(sink)
    }
  }
}

export const solutionEventPublisher = createSolutionEventPublisher()
