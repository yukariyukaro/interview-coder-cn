import { ipcMain } from 'electron'
import WebSocket from 'ws'
import { randomUUID } from 'node:crypto'

const WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference/'

let ws: WebSocket | null = null
let taskId: string | null = null
let isTranscribing = false
let taskStarted = false
let accumulatedText = ''
let currentPartial = ''
// Track the last finalized sentence id: the server may re-send or overlap
// sentence results under fast speech, and heartbeat packets use sentence_id 0.
let lastFinalSentenceId = 0

function sendToRenderer(channel: string, ...args: unknown[]) {
  const mainWindow = global.mainWindow
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

function cleanup() {
  if (ws) {
    ws.removeAllListeners()
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close()
    }
    ws = null
  }
  taskId = null
  isTranscribing = false
  taskStarted = false
  lastFinalSentenceId = 0
}

function startTranscription(apiKey: string) {
  if (isTranscribing) return

  cleanup()
  isTranscribing = true
  taskId = randomUUID()

  ws = new WebSocket(WS_URL, {
    headers: { Authorization: `bearer ${apiKey}` }
  })

  ws.on('open', () => {
    const runTask = {
      header: {
        action: 'run-task',
        task_id: taskId,
        streaming: 'duplex'
      },
      payload: {
        task_group: 'audio',
        task: 'asr',
        function: 'recognition',
        model: 'qwen3-asr-flash-realtime',
        parameters: {
          format: 'pcm',
          sample_rate: 16000
        },
        input: {}
      }
    }
    ws!.send(JSON.stringify(runTask))
  })

  ws.on('message', (data: WebSocket.Data) => {
    try {
      const msg = JSON.parse(data.toString())
      const event = msg.header?.event

      if (event === 'task-started') {
        taskStarted = true
        return
      }

      if (event === 'result-generated') {
        const sentence = msg.payload?.output?.sentence
        if (!sentence) return

        // Heartbeat packets (sentence_id 0) carry no useful text — skip them
        // to avoid overlapping with the tail of the previous sentence.
        if (sentence.heartbeat === true) return

        const text: string = sentence.text || ''
        const sentenceEnd: boolean = sentence.sentence_end === true
        const sentenceId: number = sentence.sentence_id ?? 0

        if (sentenceEnd) {
          // Only append when this sentence has never been finalized before,
          // so a re-delivered final result cannot duplicate characters.
          if (text && sentenceId > lastFinalSentenceId) {
            accumulatedText += text
            lastFinalSentenceId = sentenceId
          }
          currentPartial = ''
        } else if (sentence.sentence_begin === true) {
          // New sentence: drop any stale partial first.
          currentPartial = text
        } else {
          currentPartial = text
        }

        sendToRenderer('transcription-text', {
          text: getTranscriptionText(),
          isPartial: !sentenceEnd
        })
        return
      }

      if (event === 'task-failed') {
        const errorMsg = msg.header?.error_message || '语音识别失败'
        console.error('Transcription task failed:', errorMsg)
        sendToRenderer('transcription-error', errorMsg)
        cleanup()
        sendToRenderer('transcription-stopped')
        return
      }

      if (event === 'task-finished') {
        cleanup()
        sendToRenderer('transcription-stopped')
      }
    } catch (e) {
      console.error('Failed to parse transcription message:', e)
    }
  })

  ws.on('error', (err) => {
    console.error('Transcription WebSocket error:', err)
    sendToRenderer('transcription-error', err.message || 'WebSocket 连接失败')
    cleanup()
    sendToRenderer('transcription-stopped')
  })

  ws.on('close', () => {
    if (isTranscribing) {
      isTranscribing = false
      sendToRenderer('transcription-stopped')
    }
    ws = null
    taskStarted = false
  })
}

function stopTranscription() {
  if (!isTranscribing) return

  if (ws && ws.readyState === WebSocket.OPEN && taskId && taskStarted) {
    const finishTask = {
      header: {
        action: 'finish-task',
        task_id: taskId,
        streaming: 'duplex'
      },
      payload: {
        input: {}
      }
    }
    // Keep the connection open until task-finished arrives, so the tail
    // result of the last sentence is flushed before teardown.
    ws.send(JSON.stringify(finishTask))
  }

  isTranscribing = false
}

function handleAudioChunk(chunk: ArrayBuffer) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !taskStarted) return
  ws.send(Buffer.from(chunk))
}

export function getTranscriptionText(): string {
  return accumulatedText + currentPartial
}

export function clearTranscriptionText() {
  accumulatedText = ''
  currentPartial = ''
  lastFinalSentenceId = 0
}

ipcMain.handle('start-transcription', (_event, apiKey: string) => {
  startTranscription(apiKey)
})

ipcMain.handle('stop-transcription', () => {
  stopTranscription()
})

ipcMain.on('transcription-audio-chunk', (_event, chunk: ArrayBuffer) => {
  handleAudioChunk(chunk)
})

ipcMain.handle('get-transcription-text', () => {
  return getTranscriptionText()
})

ipcMain.handle('clear-transcription-text', () => {
  clearTranscriptionText()
})
