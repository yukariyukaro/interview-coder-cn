import { SYNC_PROTOCOL_VERSION, type SyncEvent } from '@interview-coder/sync-protocol'

import { initialSessionState, sessionReducer } from '../sync/session-reducer'

const envelope = {
  version: SYNC_PROTOCOL_VERSION,
  eventId: 'event-1',
  sessionId: 'session-1',
  seq: 1,
  timestamp: 1_725_000_000_000
} as const

function receive(event: unknown) {
  return { type: 'event.received', payload: event } as const
}

describe('sessionReducer', () => {
  it('按序拼接答案增量并更新请求状态', () => {
    const reset: SyncEvent = { ...envelope, type: 'session.reset', payload: {} }
    const firstDelta: SyncEvent = {
      ...envelope,
      eventId: 'event-2',
      seq: 2,
      type: 'solution.delta',
      payload: { text: '第一段' }
    }
    const secondDelta: SyncEvent = {
      ...envelope,
      eventId: 'event-3',
      seq: 3,
      type: 'solution.delta',
      payload: { text: '第二段' }
    }

    const resetState = sessionReducer(initialSessionState, receive(reset))
    const firstState = sessionReducer(resetState, receive(firstDelta))
    const nextState = sessionReducer(firstState, receive(secondDelta))

    expect(nextState.solution).toBe('第一段第二段')
    expect(nextState.lastSeq).toBe(3)
    expect(nextState.protocolError).toBeNull()
  })

  it('忽略同一会话中重复或过期的序号', () => {
    const snapshot: SyncEvent = {
      ...envelope,
      seq: 8,
      type: 'session.snapshot',
      payload: {
        solution: '完整答案',
        screenshotTotal: 2,
        requestStatus: 'completed',
        errorMessage: null
      }
    }
    const duplicate: SyncEvent = {
      ...envelope,
      eventId: 'event-duplicate',
      seq: 8,
      type: 'solution.delta',
      payload: { text: '不应重复' }
    }

    const snapshotState = sessionReducer(initialSessionState, receive(snapshot))
    const nextState = sessionReducer(snapshotState, receive(duplicate))

    expect(nextState).toEqual(snapshotState)
  })

  it('通过 session.snapshot 恢复完整会话', () => {
    const snapshot: SyncEvent = {
      ...envelope,
      seq: 12,
      type: 'session.snapshot',
      payload: {
        solution: '恢复后的答案',
        screenshotTotal: 4,
        requestStatus: 'loading',
        errorMessage: null
      }
    }

    const nextState = sessionReducer(initialSessionState, receive(snapshot))

    expect(nextState).toMatchObject({
      sessionId: 'session-1',
      lastSeq: 12,
      solution: '恢复后的答案',
      screenshotTotal: 4,
      requestStatus: 'loading',
      errorMessage: null,
      protocolError: null
    })
  })

  it('新会话重置会清空上一会话内容', () => {
    const previousState = {
      ...initialSessionState,
      sessionId: 'session-old',
      lastSeq: 6,
      solution: '旧答案',
      screenshotTotal: 3,
      requestStatus: 'completed' as const
    }
    const reset: SyncEvent = {
      ...envelope,
      eventId: 'event-new',
      sessionId: 'session-new',
      type: 'session.reset',
      payload: {}
    }

    const nextState = sessionReducer(previousState, receive(reset))

    expect(nextState).toEqual({
      ...initialSessionState,
      sessionId: 'session-new',
      lastSeq: 1
    })
  })

  it('拒绝字段缺失或类型异常的事件且不生成答案文本', () => {
    const invalidEvent = {
      ...envelope,
      type: 'solution.delta',
      payload: {}
    }

    const nextState = sessionReducer(initialSessionState, receive(invalidEvent))

    expect(nextState.solution).toBe('')
    expect(nextState.protocolError).toBe('收到不符合协议的同步事件')
  })

  it('拒绝未初始化会话的增量事件', () => {
    const delta: SyncEvent = {
      ...envelope,
      type: 'solution.delta',
      payload: { text: '孤立增量' }
    }

    const nextState = sessionReducer(initialSessionState, receive(delta))

    expect(nextState.solution).toBe('')
    expect(nextState.protocolError).toBe('同步事件的会话顺序无效')
  })
})
