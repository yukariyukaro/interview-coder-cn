import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSolutionStream: vi.fn(),
  takeScreenshot: vi.fn(),
  saveScreenshotToDisk: vi.fn(),
  getTranscriptionText: vi.fn(() => ''),
  clearTranscriptionText: vi.fn(),
  resetSession: vi.fn(),
  publish: vi.fn(),
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
  getFollowUpStream: vi.fn()
}))
vi.mock('./take-screenshot', () => ({ takeScreenshot: mocks.takeScreenshot }))
vi.mock('./save-screenshot', () => ({ saveScreenshotToDisk: mocks.saveScreenshotToDisk }))
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
    publish: mocks.publish
  }
}))

import { takeNewScreenshot } from './solution-controller'

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
  })
})
