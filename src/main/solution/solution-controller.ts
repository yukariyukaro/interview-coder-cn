import type { BrowserWindow } from 'electron'
import type { ModelMessage } from 'ai'

import { getFollowUpStream, getGeneralStream, getSolutionStream } from './ai'
import { createAnswerFilename, saveAnswerToDisk } from './save-answer'
import { saveScreenshotToDisk } from './save-screenshot'
import {
  createTranscriptFilename,
  formatTranscriptDocument,
  formatTranscriptLine,
  formatTranscriptSection,
  saveTranscriptToDisk
} from './save-transcript'
import { getEffectiveAISettings, settings } from '../core/settings'
import { solutionEventPublisher } from './solution-events'
import { createSolutionDeltaBuffer } from './solution-delta-buffer'
import { state } from '../core/state'
import { takeScreenshot } from './take-screenshot'
import {
  AUDIO_SOURCES,
  clearTranscriptionText,
  consumePendingTranscription,
  onTranscriptionSegment,
  SOURCE_LABELS,
  type AudioSource,
  type TranscriptionSegment
} from '../input/transcription'

type AbortReason = 'user' | 'new-request'

type RequestContentPart = { type: 'text'; text: string } | { type: 'image'; image: string }

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
let answerFilename = ''
/** The session's transcript: one file for the whole run, a section per conversation round */
const transcriptFilename = createTranscriptFilename()
const transcriptLines: string[] = []

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

/**
 * Open a conversation round: the file the answer is saved to, the transcript section
 * it belongs to, and the event session every later publish needs.
 */
function startSolutionSession(startedAt = new Date()): void {
  answerFilename = createAnswerFilename(startedAt)
  recordTranscriptSection(startedAt)
  solutionEventPublisher.resetSession()
}

function resetSolutionSession(mainWindow: BrowserWindow): void {
  solutionDeltaBuffer.clear()
  startSolutionSession()
  clearTranscriptionText()
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

async function sendRequestCompleted(mainWindow: BrowserWindow): Promise<void> {
  solutionDeltaBuffer.flush()
  mainWindow.webContents.send('solution-complete')
  solutionEventPublisher.publish('request.completed', {})
  const snapshot = solutionEventPublisher.getSnapshot()
  await saveAnswerToDisk(snapshot.payload.solution, answerFilename)
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

/**
 * Everything said since the last request, each track tagged with who spoke. That tag
 * is all the prompt needs: any image in a request is a screenshot and any spoken line
 * is a transcript, so neither has to be announced as such.
 */
function takeTranscription(): string {
  return AUDIO_SOURCES.map((source) => ({
    source,
    text: consumePendingTranscription(source)
      .map((segment) => segment.text.trim())
      .join('')
  }))
    .filter(({ text }) => Boolean(text))
    .map(({ source, text }) => `[${SOURCE_LABELS[source]}] ${text}`)
    .join('\n')
}

/**
 * A request carries the inputs themselves: the screenshot, plus whatever was new on
 * either track. The spoken part is left out when there is nothing new, so an image
 * can also arrive on its own.
 */
function buildRequestContent(transcription: string, screenshot: string): RequestContentPart[] {
  const content: RequestContentPart[] = []
  if (transcription) content.push({ type: 'text', text: transcription })
  content.push({ type: 'image', image: screenshot })
  return content
}

function persistTranscript(): Promise<void> {
  return saveTranscriptToDisk(formatTranscriptDocument(transcriptLines), transcriptFilename)
}

/** Open a section for a new conversation round inside the session's transcript */
function recordTranscriptSection(startedAt: Date): void {
  if (transcriptLines.length > 0) transcriptLines.push('')
  transcriptLines.push(formatTranscriptSection(startedAt.getTime()))
  void persistTranscript()
}

/**
 * Mirror every utterance to the session transcript as it is finalized, so the spoken
 * context outlives both the on-screen buffer and the conversation itself.
 */
function archiveTranscriptionSegment(source: AudioSource, segment: TranscriptionSegment): void {
  transcriptLines.push(formatTranscriptLine(source, segment))
  void persistTranscript()
}

onTranscriptionSegment(archiveTranscriptionSegment)

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
    await sendRequestCompleted(mainWindow)
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
  const transcriptionText = takeTranscription()
  conversationMessages = [
    {
      role: 'user',
      content: buildRequestContent(transcriptionText, screenshotData)
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
  const transcriptionText = takeTranscription()
  conversationMessages.push({
    role: 'user',
    content: buildRequestContent(transcriptionText, screenshotData)
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

/**
 * Send the transcription accumulated since the last request to the AI without taking
 * a screenshot (the interview flow: transcription can be sent on its own and acts as
 * an incremental input to the existing conversation).
 */
export async function sendTranscriptionOnly(): Promise<void> {
  const mainWindow = getReadyMainWindow()
  if (!mainWindow) return

  const transcriptionText = takeTranscription()
  if (!transcriptionText) {
    // Pressing the shortcut with nothing new to send looks exactly like a shortcut
    // that does not work, so say so instead of returning silently
    mainWindow.webContents.send('transcription-empty')
    return
  }

  requestGeneration += 1
  abortCurrentStream('new-request')
  const context = createStreamContext()

  const message: ModelMessage = {
    role: 'user',
    content: [{ type: 'text', text: transcriptionText }]
  }
  // Without a screenshot there is nothing on screen yet, so this request is what
  // starts the round: it has to open the session itself, otherwise publishing the
  // very first event throws and the request never runs
  const startsRound = conversationMessages.length === 0
  if (startsRound) {
    startSolutionSession()
    conversationMessages = [message]
  } else {
    conversationMessages.push(message)
  }

  sendRequestStarted(mainWindow)
  // A round's first output needs no separator; a leading rule would just be noise
  if (!startsRound) sendSolutionDelta(hasAppendSeparator ? '\n\n' : '\n\n---\n\n')
  hasAppendSeparator = true

  await runStream({
    mainWindow,
    context,
    createStream: () => getGeneralStream(conversationMessages, context.controller.signal),
    errorLabel: 'Error streaming transcription input:',
    onCompleted: (response) => {
      if (response) conversationMessages.push({ role: 'assistant', content: response })
    }
  })
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
