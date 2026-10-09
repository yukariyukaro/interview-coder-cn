import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranscriptionSegment } from '../input/transcription'

const mocks = vi.hoisted(() => ({
  getSolutionStream: vi.fn(),
  getGeneralStream: vi.fn(),
  getFollowUpStream: vi.fn(),
  takeScreenshot: vi.fn(),
  saveScreenshotToDisk: vi.fn(),
  createAnswerFilename: vi.fn(() => 'answer-session.md'),
  saveAnswerToDisk: vi.fn(),
  createTranscriptFilename: vi.fn(() => 'transcript-session.md'),
  saveTranscriptToDisk: vi.fn(),
  onTranscriptionSegment: vi.fn(),
  consumePendingTranscription: vi.fn((): TranscriptionSegment[] => []),
  clearTranscriptionText: vi.fn(),
  resetSession: vi.fn(),
  publish: vi.fn(),
  getSnapshot: vi.fn(() => ({ payload: { solution: '答案：C' } })),
  settings: { apiKey: 'key' },
  getEffectiveAISettings: vi.fn((settings: { apiKey: string }) => ({
    apiBaseURL: '',
    apiKey: settings.apiKey,
    model: ''
  })),
  state: { inCoderPage: true }
}))

vi.mock('./ai', () => ({
  getSolutionStream: mocks.getSolutionStream,
  getGeneralStream: mocks.getGeneralStream,
  getFollowUpStream: mocks.getFollowUpStream
}))
vi.mock('./take-screenshot', () => ({ takeScreenshot: mocks.takeScreenshot }))
vi.mock('./save-screenshot', () => ({ saveScreenshotToDisk: mocks.saveScreenshotToDisk }))
vi.mock('./save-answer', () => ({
  createAnswerFilename: mocks.createAnswerFilename,
  saveAnswerToDisk: mocks.saveAnswerToDisk
}))
vi.mock('./save-transcript', () => ({
  createTranscriptFilename: mocks.createTranscriptFilename,
  saveTranscriptToDisk: mocks.saveTranscriptToDisk,
  formatTranscriptLine: vi.fn((_source: string, segment: { text: string }) => segment.text),
  formatTranscriptSection: vi.fn((at: number) => `### ${at}`),
  formatTranscriptDocument: vi.fn((lines: string[]) => lines.join('\n'))
}))
vi.mock('../core/settings', () => ({
  settings: mocks.settings,
  getEffectiveAISettings: mocks.getEffectiveAISettings
}))
vi.mock('../core/state', () => ({ state: mocks.state }))
vi.mock('../input/transcription', () => ({
  AUDIO_SOURCES: ['system', 'mic'],
  SOURCE_LABELS: { system: '面试官', mic: '候选人' },
  onTranscriptionSegment: mocks.onTranscriptionSegment,
  consumePendingTranscription: mocks.consumePendingTranscription,
  clearTranscriptionText: mocks.clearTranscriptionText
}))
vi.mock('./solution-events', () => ({
  solutionEventPublisher: {
    resetSession: mocks.resetSession,
    publish: mocks.publish,
    getSnapshot: mocks.getSnapshot
  }
}))

import { sendFollowUpQuestion, takeNewScreenshot } from './solution-controller'

function createStream(chunks: string[]): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    }
  }
}

describe('solution controller', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.takeScreenshot.mockResolvedValue('base64-image')
    mocks.getSolutionStream.mockReturnValue(createStream(['答案', '：C']))
    mocks.getFollowUpStream.mockReturnValue(createStream(['补充答案']))
    mocks.getSnapshot.mockReturnValue({ payload: { solution: '答案：C' } })
    mocks.settings.apiKey = 'key'
    mocks.state.inCoderPage = true
  })

  it('flushes coalesced deltas before the completion event', async () => {
    const send = vi.fn()
    global.mainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send }
    } as never

    await takeNewScreenshot()

    const solutionChunkCall = send.mock.calls.findIndex(([channel]) => channel === 'solution-chunk')
    const completeCall = send.mock.calls.findIndex(([channel]) => channel === 'solution-complete')
    expect(solutionChunkCall).toBeGreaterThan(-1)
    expect(completeCall).toBeGreaterThan(solutionChunkCall)
    expect(send).toHaveBeenCalledWith('solution-chunk', '答案：C')
    expect(mocks.publish).toHaveBeenCalledWith('solution.delta', { text: '答案：C' })
    expect(mocks.saveAnswerToDisk).toHaveBeenCalledWith('答案：C', 'answer-session.md')
  })

  it('opens the round itself when a transcription-only request comes first', async () => {
    // Without a screenshot nothing has opened the event session yet, and publishing
    // `request.started` threw before the stream was created — the request never ran.
    // A fresh module is needed: the conversation is module state that earlier tests fill
    vi.resetModules()
    const { sendTranscriptionOnly: sendTranscriptionFirst } = await import('./solution-controller')
    const send = vi.fn()
    global.mainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send }
    } as never
    mocks.consumePendingTranscription.mockReturnValueOnce([{ text: '我做过一个项目', at: 1 }])
    mocks.getGeneralStream.mockReturnValueOnce(createStream(['收到']))

    await sendTranscriptionFirst()

    expect(mocks.resetSession).toHaveBeenCalled()
    expect(mocks.getGeneralStream).toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('ai-loading-start')
    expect(send).toHaveBeenCalledWith('solution-chunk', '收到')
    expect(send).toHaveBeenCalledWith('solution-complete')
    expect(mocks.saveAnswerToDisk).toHaveBeenCalledWith('答案：C', 'answer-session.md')
  })

  it('updates the same Markdown file with the complete answer after a follow-up', async () => {
    global.mainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: vi.fn() }
    } as never
    mocks.getSnapshot
      .mockReturnValueOnce({ payload: { solution: '答案：C' } })
      .mockReturnValueOnce({ payload: { solution: '答案：C\n\n---\n\n补充答案' } })

    await takeNewScreenshot()
    await sendFollowUpQuestion('为什么？')

    expect(mocks.createAnswerFilename).toHaveBeenCalledTimes(1)
    expect(mocks.saveAnswerToDisk).toHaveBeenNthCalledWith(1, '答案：C', 'answer-session.md')
    expect(mocks.saveAnswerToDisk).toHaveBeenNthCalledWith(
      2,
      '答案：C\n\n---\n\n补充答案',
      'answer-session.md'
    )
  })
})
