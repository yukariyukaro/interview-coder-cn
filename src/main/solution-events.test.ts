import { describe, expect, it, vi } from 'vitest'

import { createSolutionEventPublisher } from './solution-events'

function createPublisher() {
  let sessionSequence = 0
  let eventSequence = 0
  return createSolutionEventPublisher({
    createSessionId: () => `session-${++sessionSequence}`,
    createEventId: () => `event-${++eventSequence}`,
    now: () => 1_725_000_000_000 + eventSequence
  })
}

describe('createSolutionEventPublisher', () => {
  it('publishes ordered events and aggregates a reconnect snapshot', () => {
    const publisher = createPublisher()
    const events: unknown[] = []
    publisher.addSink((event) => events.push(event))

    publisher.resetSession()
    publisher.publish('screenshot.updated', { total: 2 })
    publisher.publish('request.started', {})
    publisher.publish('solution.delta', { text: 'A' })
    publisher.publish('solution.delta', { text: 'B' })
    publisher.publish('request.completed', {})

    expect(events.map((event) => (event as { seq: number }).seq)).toEqual([1, 2, 3, 4, 5, 6])
    expect(publisher.getSnapshot()).toMatchObject({
      sessionId: 'session-1',
      seq: 6,
      type: 'session.snapshot',
      payload: {
        solution: 'AB',
        screenshotTotal: 2,
        requestStatus: 'completed',
        errorMessage: null
      }
    })
  })

  it('resets all aggregate state for a new session', () => {
    const publisher = createPublisher()
    publisher.resetSession()
    publisher.publish('solution.delta', { text: 'old answer' })
    publisher.publish('request.failed', { message: 'upstream failed' })

    const reset = publisher.resetSession()

    expect(reset).toMatchObject({ sessionId: 'session-2', seq: 1, type: 'session.reset' })
    expect(publisher.getSnapshot()).toMatchObject({
      sessionId: 'session-2',
      seq: 1,
      payload: {
        solution: '',
        screenshotTotal: 0,
        requestStatus: 'idle',
        errorMessage: null
      }
    })
  })

  it('supports removing a sink', () => {
    const publisher = createPublisher()
    const sink = vi.fn()
    const removeSink = publisher.addSink(sink)

    publisher.resetSession()
    removeSink()
    publisher.publish('request.started', {})

    expect(sink).toHaveBeenCalledTimes(1)
  })

  it('rejects payload fields outside the protocol whitelist', () => {
    const publisher = createPublisher()
    publisher.resetSession()

    expect(() =>
      publisher.publish('screenshot.updated', {
        total: 1,
        screenshotData: 'data:image/png;base64,secret'
      } as never)
    ).toThrow()
    expect(JSON.stringify(publisher.getSnapshot())).not.toContain('base64')
  })

  it('creates a valid idle snapshot before the first request', () => {
    const publisher = createPublisher()

    expect(publisher.getSnapshot()).toMatchObject({
      sessionId: 'session-1',
      seq: 1,
      type: 'session.snapshot',
      payload: {
        solution: '',
        screenshotTotal: 0,
        requestStatus: 'idle',
        errorMessage: null
      }
    })
  })
})
