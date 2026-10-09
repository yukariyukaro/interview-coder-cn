import { ipcMain } from 'electron'
import WebSocket from 'ws'
import { randomUUID } from 'node:crypto'

// Qwen-ASR-Realtime speaks the OpenAI-Realtime-style protocol, which is NOT
// compatible with the legacy run-task duplex endpoint (/api-ws/v1/inference):
// using the old endpoint with this model yields "close code 1007 Model not found".
const WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime'

/**
 * The two tracks we transcribe, each with its own connection: `system` is what the
 * speakers play (the interviewer), `mic` is the user's own voice (the candidate).
 * Keeping them apart is what makes speaker attribution possible at all — the
 * realtime model does not do diarization.
 */
export type AudioSource = 'system' | 'mic'

export const AUDIO_SOURCES: AudioSource[] = ['system', 'mic']

/** Who a track belongs to. The prompt and the on-disk transcript both label lines with it. */
export const SOURCE_LABELS: Record<AudioSource, string> = {
  system: '面试官',
  mic: '候选人'
}

export function isAudioSource(value: unknown): value is AudioSource {
  return value === 'system' || value === 'mic'
}

/**
 * One finalized utterance. Segments are the durable record of what was said: the
 * display and the on-disk transcript are both built from them, and handing them to
 * the AI only advances a cursor instead of wiping them.
 */
export type TranscriptionSegment = {
  text: string
  at: number
}

type Session = {
  /** The live socket, or null when this track is not listening */
  ws: WebSocket | null
  /**
   * Bumped on every start. Events from a socket that no longer owns the session are
   * ignored, so a restarted track cannot have the tail of the previous one's
   * `session.finished` reset its state or report it as stopped.
   */
  generation: number
  sessionReady: boolean
  /** Finalized utterances in arrival order; never cleared while transcribing */
  segments: TranscriptionSegment[]
  /** How many `segments` were already handed to the AI */
  consumedSegments: number
  /**
   * Item whose in-flight draft was already handed to the AI. Its final result is
   * still appended for the display and the archive, but is not sent a second time.
   */
  consumedDraftItem: string | null
  currentPartial: string
  // Confirmed prefixes keyed by item id: partial events ("...transcription.text")
  // carry the confirmed prefix plus a mutable stash draft; final results
  // ("...transcription.completed") arrive per item id.
  confirmedByItem: Map<string, string>
  currentItem: string | null
  finishTimeout: NodeJS.Timeout | null
  /** The renderer was already told this track stopped */
  announced: boolean
}

const sessions = new Map<AudioSource, Session>()

const segmentListeners: Array<(source: AudioSource, segment: TranscriptionSegment) => void> = []

/** Subscribe to finalized utterances, e.g. to mirror them to disk */
export function onTranscriptionSegment(
  listener: (source: AudioSource, segment: TranscriptionSegment) => void
): void {
  segmentListeners.push(listener)
}

function getSession(source: AudioSource): Session {
  let session = sessions.get(source)
  if (!session) {
    session = {
      ws: null,
      generation: 0,
      sessionReady: false,
      segments: [],
      consumedSegments: 0,
      consumedDraftItem: null,
      currentPartial: '',
      confirmedByItem: new Map(),
      currentItem: null,
      finishTimeout: null,
      announced: true
    }
    sessions.set(source, session)
  }
  return session
}

function appendSegment(source: AudioSource, itemId: string, text: string): void {
  if (!text) return
  const current = getSession(source)
  const segment = { text, at: Date.now() }
  current.segments.push(segment)
  // A draft that was already sent must not be sent again once it is finalized
  if (current.consumedDraftItem === itemId) {
    current.consumedSegments = current.segments.length
    current.consumedDraftItem = null
  }
  segmentListeners.forEach((listener) => listener(source, segment))
}

function sendToRenderer(channel: string, ...args: unknown[]) {
  const mainWindow = global.mainWindow
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

function nextEventId() {
  return `evt_${randomUUID()}`
}

/** Detach a socket for good: its listeners and the connection itself */
function discardSocket(socket: WebSocket | null): void {
  if (!socket) return
  socket.removeAllListeners()
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    socket.close()
  }
}

/** Drop a socket and release the session only if that socket still owns it */
function cleanup(source: AudioSource, socket: WebSocket | null, generation: number): void {
  const current = getSession(source)
  if (current.generation !== generation) {
    discardSocket(socket)
    return
  }
  if (current.finishTimeout) {
    clearTimeout(current.finishTimeout)
    current.finishTimeout = null
  }
  if (current.ws === socket) current.ws = null
  discardSocket(socket)
  current.sessionReady = false
  current.confirmedByItem.clear()
  current.currentItem = null
}

/** Tell the renderer the track is down, at most once per session */
function announceStopped(source: AudioSource, generation: number): void {
  const current = getSession(source)
  if (current.generation !== generation || current.announced) return
  current.announced = true
  sendToRenderer('transcription-stopped', source)
}

/** What the UI shows: every finalized utterance plus the live draft */
function getSessionText(source: AudioSource): string {
  const current = getSession(source)
  return current.segments.map((segment) => segment.text).join('') + current.currentPartial
}

function handlePartial(
  source: AudioSource,
  evt: { item_id?: string; text?: string; stash?: string }
) {
  const current = getSession(source)
  const itemId = evt.item_id || ''
  if (!itemId) return
  current.confirmedByItem.set(itemId, evt.text || '')

  // If a new item starts while the previous one was finalized implicitly,
  // drop the stale partial.
  if (current.currentItem && current.currentItem !== itemId) {
    const prev = current.confirmedByItem.get(current.currentItem)
    if (prev !== undefined) {
      appendSegment(source, current.currentItem, prev)
      current.confirmedByItem.delete(current.currentItem)
    }
  }
  current.currentItem = itemId
  current.currentPartial = (evt.text || '') + (evt.stash || '')

  sendToRenderer('transcription-text', source, { text: getSessionText(source), isPartial: true })
}

function handleCompleted(source: AudioSource, evt: { item_id?: string; transcript?: string }) {
  const current = getSession(source)
  const itemId = evt.item_id || ''

  // Prefer the final transcript; fall back to the accumulated confirmed text.
  const confirmed = current.confirmedByItem.get(itemId) || ''
  appendSegment(source, itemId, evt.transcript || confirmed)
  current.confirmedByItem.delete(itemId)
  if (current.currentItem === itemId) {
    current.currentItem = null
    current.currentPartial = ''
  }

  sendToRenderer('transcription-text', source, { text: getSessionText(source), isPartial: false })
}

function startTranscription(apiKey: string, source: AudioSource): void {
  const current = getSession(source)
  if (current.ws) return

  // A previous connection may still be flushing its last sentence; hand the session
  // over to the new one and let the old socket wind down unseen.
  if (current.finishTimeout) {
    clearTimeout(current.finishTimeout)
    current.finishTimeout = null
  }
  const generation = ++current.generation
  current.ws = null
  current.sessionReady = false
  current.confirmedByItem.clear()
  current.currentItem = null
  current.announced = false

  const ws = new WebSocket(WS_URL, {
    headers: { Authorization: `bearer ${apiKey}` }
  })
  current.ws = ws

  const isStale = () => current.generation !== generation

  ws.on('open', () => {
    if (isStale()) return
    const sessionUpdate = {
      event_id: nextEventId(),
      type: 'session.update',
      session: {
        input_audio_format: 'pcm',
        sample_rate: 16000,
        input_audio_transcription: {
          language: 'zh'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.0,
          silence_duration_ms: 400
        }
      }
    }
    ws.send(JSON.stringify(sessionUpdate))
  })

  ws.on('message', (data: WebSocket.Data) => {
    if (isStale()) return
    try {
      const msg = JSON.parse(data.toString())
      const event: string = msg.type || ''

      if (event === 'session.created' || event === 'session.updated') {
        current.sessionReady = true
        return
      }

      if (event === 'conversation.item.input_audio_transcription.text') {
        handlePartial(source, msg)
        return
      }

      if (event === 'conversation.item.input_audio_transcription.completed') {
        handleCompleted(source, msg)
        return
      }

      if (event === 'conversation.item.input_audio_transcription.failed') {
        console.error(`Transcription item failed (${source}):`, msg.error?.message)
        return
      }

      if (event === 'session.finished') {
        cleanup(source, ws, generation)
        announceStopped(source, generation)
        return
      }

      if (event === 'error') {
        const errorMsg = msg.error?.message || '语音识别失败'
        console.error(`Transcription error (${source}):`, errorMsg)
        sendToRenderer('transcription-error', source, errorMsg)
        cleanup(source, ws, generation)
        announceStopped(source, generation)
      }
    } catch (e) {
      console.error('Failed to parse transcription message:', e)
    }
  })

  ws.on('error', (err) => {
    console.error(`Transcription WebSocket error (${source}):`, err)
    if (isStale()) return
    sendToRenderer('transcription-error', source, err.message || 'WebSocket 连接失败')
    cleanup(source, ws, generation)
    announceStopped(source, generation)
  })

  ws.on('close', () => {
    cleanup(source, ws, generation)
    announceStopped(source, generation)
  })
}

function stopTranscription(source: AudioSource): void {
  const current = getSession(source)
  const ws = current.ws
  if (!ws) return
  const generation = current.generation

  // Dropping the session's socket already stops audio from being appended and
  // reports the track as down; the connection itself stays open until
  // session.finished arrives, so the tail result of the last sentence is flushed.
  current.ws = null

  if (ws.readyState !== WebSocket.OPEN) {
    announceStopped(source, generation)
    return
  }

  ws.send(JSON.stringify({ event_id: nextEventId(), type: 'session.finish' }))
  current.finishTimeout = setTimeout(() => {
    cleanup(source, ws, generation)
    announceStopped(source, generation)
  }, 3000)
}

function handleAudioChunk(chunk: ArrayBuffer, source: AudioSource) {
  const current = getSession(source)
  const ws = current.ws
  if (!ws || ws.readyState !== WebSocket.OPEN || !current.sessionReady) return
  ws.send(
    JSON.stringify({
      event_id: nextEventId(),
      type: 'input_audio_buffer.append',
      audio: Buffer.from(chunk).toString('base64')
    })
  )
}

/**
 * Hand over everything one track said since the last hand-over. The display keeps its
 * text: the transcript stays readable after it was sent (it used to be wiped on every
 * screenshot).
 */
export function consumePendingTranscription(source: AudioSource): TranscriptionSegment[] {
  const current = getSession(source)
  const pending = current.segments.slice(current.consumedSegments)
  current.consumedSegments = current.segments.length
  // Send the sentence still being recognized too, but remember it so the finalized
  // result is not sent a second time
  if (current.currentPartial && current.currentItem) {
    pending.push({ text: current.currentPartial, at: Date.now() })
    current.consumedDraftItem = current.currentItem
  }
  return pending
}

/** Drop what is on screen: one track, or both when no source is named */
export function clearTranscriptionText(source?: AudioSource): void {
  const targets = source ? [source] : AUDIO_SOURCES
  targets.forEach((target) => {
    const current = sessions.get(target)
    if (!current) return
    current.segments = []
    current.consumedSegments = 0
    current.consumedDraftItem = null
    current.currentPartial = ''
    current.confirmedByItem.clear()
    current.currentItem = null
    sendToRenderer('transcription-cleared', target)
  })
}

/** Whether a track is currently listening. The renderer realigns its UI state against this. */
export function getTranscriptionStatus(source: AudioSource): boolean {
  return Boolean(sessions.get(source)?.ws)
}

/** What the UI should currently show, for a renderer that just (re)mounted */
export function getTranscriptionText(source: AudioSource): string {
  return sessions.has(source) ? getSessionText(source) : ''
}

ipcMain.handle('start-transcription', (_event, apiKey: string, source: AudioSource) => {
  if (!isAudioSource(source) || typeof apiKey !== 'string' || !apiKey) return
  startTranscription(apiKey, source)
})

ipcMain.handle('stop-transcription', (_event, source: AudioSource) => {
  if (!isAudioSource(source)) return
  stopTranscription(source)
})

ipcMain.handle('get-transcription-status', (_event, source: AudioSource) => {
  return isAudioSource(source) ? getTranscriptionStatus(source) : false
})

ipcMain.handle('get-transcription-text', (_event, source: AudioSource) => {
  return isAudioSource(source) ? getTranscriptionText(source) : ''
})

ipcMain.on('transcription-audio-chunk', (_event, chunk: ArrayBuffer, source: AudioSource) => {
  if (!isAudioSource(source)) return
  handleAudioChunk(chunk, source)
})
