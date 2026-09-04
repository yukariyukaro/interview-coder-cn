import { parseSyncEvent, type SyncEvent } from '@interview-coder/sync-protocol'

export type RequestStatus = 'idle' | 'loading' | 'completed' | 'stopped' | 'failed'

export type SessionState = {
  sessionId: string | null
  lastSeq: number
  solution: string
  screenshotTotal: number
  requestStatus: RequestStatus
  errorMessage: string | null
  protocolError: string | null
}

export type SessionAction =
  | { type: 'event.received'; payload: unknown }
  | { type: 'protocol.error'; message: string }
  | { type: 'connection.reset' }

export const initialSessionState: SessionState = {
  sessionId: null,
  lastSeq: 0,
  solution: '',
  screenshotTotal: 0,
  requestStatus: 'idle',
  errorMessage: null,
  protocolError: null
}

function restoreSnapshot(event: Extract<SyncEvent, { type: 'session.snapshot' }>): SessionState {
  return {
    sessionId: event.sessionId,
    lastSeq: event.seq,
    solution: event.payload.solution,
    screenshotTotal: event.payload.screenshotTotal,
    requestStatus: event.payload.requestStatus,
    errorMessage: event.payload.errorMessage,
    protocolError: null
  }
}

function applyEvent(state: SessionState, event: SyncEvent): SessionState {
  if (event.type === 'session.snapshot') {
    if (state.sessionId === event.sessionId && event.seq <= state.lastSeq) return state
    return restoreSnapshot(event)
  }

  if (event.type === 'session.reset') {
    if (state.sessionId === event.sessionId && event.seq <= state.lastSeq) return state
    return {
      ...initialSessionState,
      sessionId: event.sessionId,
      lastSeq: event.seq
    }
  }

  if (!state.sessionId || state.sessionId !== event.sessionId) {
    return { ...state, protocolError: '同步事件的会话顺序无效' }
  }
  if (event.seq <= state.lastSeq) return state

  const nextState = {
    ...state,
    lastSeq: event.seq,
    protocolError: null
  }

  switch (event.type) {
    case 'screenshot.updated':
      return { ...nextState, screenshotTotal: event.payload.total }
    case 'request.started':
      return {
        ...nextState,
        requestStatus: 'loading',
        errorMessage: null
      }
    case 'solution.delta':
      return { ...nextState, solution: state.solution + event.payload.text }
    case 'request.completed':
      return { ...nextState, requestStatus: 'completed' }
    case 'request.stopped':
      return { ...nextState, requestStatus: 'stopped' }
    case 'request.failed':
      return {
        ...nextState,
        requestStatus: 'failed',
        errorMessage: event.payload.message
      }
  }
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  if (action.type === 'connection.reset') return initialSessionState
  if (action.type === 'protocol.error') {
    return { ...state, protocolError: action.message }
  }

  const parsedEvent = parseSyncEvent(action.payload)
  if (!parsedEvent.success) {
    return { ...state, protocolError: '收到不符合协议的同步事件' }
  }
  return applyEvent(state, parsedEvent.data)
}
