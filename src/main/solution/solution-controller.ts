import type { BrowserWindow } from 'electron'
import type { ModelMessage } from 'ai'

import { getFollowUpStream, getGeneralStream, getSolutionStream } from './ai'
import { saveScreenshotToDisk } from './save-screenshot'
import { getEffectiveAISettings, settings } from '../core/settings'
import { solutionEventPublisher } from './solution-events'
import { createSolutionDeltaBuffer } from './solution-delta-buffer'
import { state } from '../core/state'
import { takeScreenshot } from './take-screenshot'
import { clearTranscriptionText, getTranscriptionText } from '../input/transcription'

type AbortReason = 'user' | 'new-request'

type StreamContext = {
  controller: AbortController
  reason: AbortReason | null
}

type StreamRequest = {
  mainWindow: BrowserWindow
  context: StreamContext
  createStream: () => AsyncIterable<string>
  errorLabel: string
  onCompleted: (response: string) => void
}

let currentStreamContext: StreamContext | null = null
let requestGeneration = 0
let conversationMessages: ModelMessage[] = []
let recentScreenshots: string[] = []
let screenshotCount = 0
let hasAppendSeparator = false

function extractErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error) || '未知错误'

  const apiError = error as Error & { responseBody?: string }
  if (apiError.responseBody) {
    try {
      const body = JSON.parse(apiError.responseBody)
      if (body.message) return body.message
      if (body.error?.message) return body.error.message
    } catch {
      if (apiError.responseBody.length < 200) return apiError.responseBody
    }
  }
  return error.message || '未知错误'
}

function emitSolutionDelta(text: string): void {
  const mainWindow = global.mainWindow
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('solution-chunk', text)
  solutionEventPublisher.publish('solution.delta', { text })
}

const solutionDeltaBuffer = createSolutionDeltaBuffer({ onFlush: emitSolutionDelta })

function sendSolutionDelta(text: string): void {
  solutionDeltaBuffer.push(text)
}

function resetSolutionSession(mainWindow: BrowserWindow): void {
  solutionDeltaBuffer.clear()
  solutionEventPublisher.resetSession()
  mainWindow.webContents.send('solution-clear')
}

function sendScreenshotUpdate(
  mainWindow: BrowserWindow,
  screenshots: string[],
  total: number
): void {
  mainWindow.webContents.send('screenshots-updated', screenshots, total)
  solutionEventPublisher.publish('screenshot.updated', { total })
}

function sendRequestStarted(mainWindow: BrowserWindow): void {
  mainWindow.webContents.send('ai-loading-start')
  solutionEventPublisher.publish('request.started', {})
}

function sendRequestCompleted(mainWindow: BrowserWindow): void {
  solutionDeltaBuffer.flush()
  mainWindow.webContents.send('solution-complete')
  solutionEventPublisher.publish('request.completed', {})
}

function sendRequestStopped(mainWindow: BrowserWindow): void {
  solutionDeltaBuffer.flush()
  mainWindow.webContents.send('solution-stopped')
  solutionEventPublisher.publish('request.stopped', {})
}

function sendRequestFailed(mainWindow: BrowserWindow, message: string): void {
  solutionDeltaBuffer.flush()
  mainWindow.webContents.send('solution-error', message)
  solutionEventPublisher.publish('request.failed', { message })
}

function abortCurrentStream(reason: AbortReason): boolean {
  if (!currentStreamContext) return false
  currentStreamContext.reason = reason
  currentStreamContext.controller.abort()
  return true
}

function createStreamContext(): StreamContext {
  const context = {
    controller: new AbortController(),
    reason: null
  }
  currentStreamContext = context
  return context
}

function consumeTranscription(mainWindow: BrowserWindow): string {
  const text = getTranscriptionText()
  if (text) {
    clearTranscriptionText()
    mainWindow.webContents.send('transcription-cleared')
  }
  return text
}

async function runStream({
  mainWindow,
  context,
  createStream,
  errorLabel,
  onCompleted
}: StreamRequest): Promise<void> {
  let streamStarted = false
  let assistantResponse = ''
  try {
    const stream = createStream()
    streamStarted = true
    try {
      for await (const chunk of stream) {
        if (context.controller.signal.aborted) break
        assistantResponse += chunk
        sendSolutionDelta(chunk)
      }
    } catch (error) {
      if (!context.controller.signal.aborted) {
        console.error(errorLabel, error)
        sendRequestFailed(mainWindow, extractErrorMessage(error))
        return
      }
    }

    if (context.controller.signal.aborted) {
      if (context.reason === 'user') sendRequestStopped(mainWindow)
      return
    }

    onCompleted(assistantResponse)
    sendRequestCompleted(mainWindow)
  } catch (error) {
    if (context.controller.signal.aborted) {
      if (context.reason === 'user') sendRequestStopped(mainWindow)
    } else {
      console.error(errorLabel, error)
      sendRequestFailed(mainWindow, extractErrorMessage(error))
    }
  } finally {
    const isCurrentStream = currentStreamContext === context
    if (isCurrentStream) currentStreamContext = null
    if (!streamStarted && context.reason === 'user') sendRequestStopped(mainWindow)
    if (isCurrentStream && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ai-loading-end')
    }
  }
}

function getReadyMainWindow(): BrowserWindow | null {
  const mainWindow = global.mainWindow
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    !state.inCoderPage ||
    !getEffectiveAISettings(settings).apiKey
  )
    return null
  return mainWindow
}

export async function takeNewScreenshot(): Promise<void> {
  const mainWindow = getReadyMainWindow()
  if (!mainWindow) return

  const captureGeneration = ++requestGeneration
  const replacedActiveRequest = abortCurrentStream('new-request')
  const screenshotData = await takeScreenshot()
  if (captureGeneration !== requestGeneration) return
  if (!screenshotData) {
    if (replacedActiveRequest) solutionEventPublisher.publish('request.stopped', {})
    return
  }

  saveScreenshotToDisk(screenshotData)
  const transcriptionText = consumeTranscription(mainWindow)
  conversationMessages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: transcriptionText
            ? `这是语音转录内容：\n${transcriptionText}\n\n同时附上屏幕截图：`
            : '这是屏幕截图'
        },
        {
          type: 'image',
          image: screenshotData
        }
      ]
    }
  ]

  const context = createStreamContext()
  recentScreenshots = [screenshotData]
  screenshotCount = 1
  hasAppendSeparator = false
  resetSolutionSession(mainWindow)
  sendScreenshotUpdate(mainWindow, recentScreenshots, screenshotCount)
  mainWindow.webContents.send('screenshot-taken', screenshotData)
  sendRequestStarted(mainWindow)

  await runStream({
    mainWindow,
    context,
    createStream: () => getSolutionStream(conversationMessages, context.controller.signal),
    errorLabel: 'Error streaming solution:',
    onCompleted: (response) => {
      if (response) conversationMessages.push({ role: 'assistant', content: response })
    }
  })
}

export async function appendScreenshot(): Promise<void> {
  const mainWindow = getReadyMainWindow()
  if (!mainWindow) return
  if (conversationMessages.length === 0) {
    await takeNewScreenshot()
    return
  }

  const captureGeneration = ++requestGeneration
  const replacedActiveRequest = abortCurrentStream('new-request')
  const screenshotData = await takeScreenshot()
  if (captureGeneration !== requestGeneration) return
  if (!screenshotData) {
    if (replacedActiveRequest) solutionEventPublisher.publish('request.stopped', {})
    return
  }

  saveScreenshotToDisk(screenshotData)
  const transcriptionText = consumeTranscription(mainWindow)
  conversationMessages.push({
    role: 'user',
    content: [
      {
        type: 'text',
        text: transcriptionText
          ? `这是下一部分截图和语音转录内容：\n${transcriptionText}\n请结合之前所有截图和分析，继续分析解答，不要遗漏任何信息。`
          : '这是下一部分截图，请结合之前所有截图和分析，继续分析解答，不要遗漏任何信息。'
      },
      {
        type: 'image',
        image: screenshotData
      }
    ]
  })

  const context = createStreamContext()
  recentScreenshots = [...recentScreenshots, screenshotData].slice(-5)
  screenshotCount += 1
  mainWindow.webContents.send('screenshot-taken', screenshotData)
  sendScreenshotUpdate(mainWindow, recentScreenshots, screenshotCount)
  sendRequestStarted(mainWindow)
  sendSolutionDelta(hasAppendSeparator ? '\n\n' : '\n\n---\n\n')
  hasAppendSeparator = true

  await runStream({
    mainWindow,
    context,
    createStream: () => getGeneralStream(conversationMessages, context.controller.signal),
    errorLabel: 'Error streaming continuous solution:',
    onCompleted: (response) => {
      if (response) conversationMessages.push({ role: 'assistant', content: response })
    }
  })
}

export function stopSolutionStream(): boolean {
  requestGeneration += 1
  return abortCurrentStream('user')
}

export async function sendFollowUpQuestion(
  question: unknown
): Promise<{ success: boolean; error?: string }> {
  const mainWindow = getReadyMainWindow()
  if (typeof question !== 'string' || !question.trim() || !mainWindow) {
    return { success: false, error: 'Invalid state' }
  }
  if (conversationMessages.length === 0) {
    return { success: false, error: 'No active conversation' }
  }

  requestGeneration += 1
  abortCurrentStream('new-request')
  const context = createStreamContext()
  sendRequestStarted(mainWindow)
  sendSolutionDelta('\n\n---\n\n')

  const normalizedQuestion = question.trim()
  await runStream({
    mainWindow,
    context,
    createStream: () =>
      getFollowUpStream(conversationMessages, normalizedQuestion, context.controller.signal),
    errorLabel: 'Error streaming follow-up solution:',
    onCompleted: (response) => {
      conversationMessages.push({
        role: 'user',
        content: [{ type: 'text', text: normalizedQuestion }]
      })
      if (response) conversationMessages.push({ role: 'assistant', content: response })
    }
  })
  return { success: true }
}
