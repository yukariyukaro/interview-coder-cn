import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSolutionStream: vi.fn(),
  getFollowUpStream: vi.fn(),
  takeScreenshot: vi.fn(),
  saveScreenshotToDisk: vi.fn(),
  createAnswerFilename: vi.fn(() => 'answer-session.md'),
  saveAnswerToDisk: vi.fn(),
  getTranscriptionText: vi.fn(() => ''),
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
  getGeneralStream: vi.fn(),
  getFollowUpStream: mocks.getFollowUpStream
}))
vi.mock('./take-screenshot', () => ({ takeScreenshot: mocks.takeScreenshot }))
vi.mock('./save-screenshot', () => ({ saveScreenshotToDisk: mocks.saveScreenshotToDisk }))
vi.mock('./save-answer', () => ({
  createAnswerFilename: mocks.createAnswerFilename,
  saveAnswerToDisk: mocks.saveAnswerToDisk
}))
vi.mock('../core/settings', () => ({
  settings: mocks.settings,
  getEffectiveAISettings: mocks.getEffectiveAISettings
}))
vi.mock('../core/state', () => ({ state: mocks.state }))
vi.mock('../input/transcription', () => ({
  getTranscriptionText: mocks.getTranscriptionText,
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
