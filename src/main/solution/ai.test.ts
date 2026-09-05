import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  streamText: vi.fn((options: Record<string, unknown>) => {
    void options
    return { textStream: Symbol('text-stream') }
  }),
  smoothStream: vi.fn(() => Symbol('smooth-transform')),
  chat: vi.fn((model: string) => ({ model })),
  settings: {
    apiBaseURL: 'https://api.openai.com/v1',
    apiKey: 'key',
    model: 'gpt-5-mini',
    customPrompt: 'prompt',
    activeSceneId: 'aptitude-test',
    scenes: [
      {
        id: 'coding',
        name: '解算法题',
        prompt: 'coding prompt',
        model: '',
        reasoningEffort: 'default',
        shortcut: 'Alt+Enter',
        isPreset: true
      },
      {
        id: 'aptitude-test',
        name: '能力测评',
        prompt: 'choice prompt',
        model: '',
        reasoningEffort: 'low',
        shortcut: 'Alt+P',
        isPreset: true
      }
    ]
  }
}))

vi.mock('ai', () => ({
  streamText: mocks.streamText,
  smoothStream: mocks.smoothStream
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => ({ chat: mocks.chat }))
}))

vi.mock('../core/settings', () => ({
  settings: mocks.settings
}))

import { getFollowUpStream, getGeneralStream, getSmoothStreamChunk, getSolutionStream } from './ai'

describe('AI streaming configuration', () => {
  beforeEach(() => {
    mocks.streamText.mockClear()
    mocks.smoothStream.mockClear()
    mocks.chat.mockClear()
    mocks.settings.model = 'gpt-5-mini'
    mocks.settings.activeSceneId = 'aptitude-test'
    mocks.settings.scenes[1].model = ''
    mocks.settings.scenes[1].reasoningEffort = 'low'
  })

  it.each([
    ['solution', () => getSolutionStream([])],
    ['follow-up', () => getFollowUpStream([], '继续')],
    ['general', () => getGeneralStream([])]
  ])('smooths provider chunks for the %s stream', (_name, createStream) => {
    createStream()

    expect(mocks.smoothStream).toHaveBeenCalledWith({
      delayInMs: 12,
      chunking: getSmoothStreamChunk
    })
    expect(mocks.streamText.mock.calls[0]![0].experimental_transform).toBe(
      mocks.smoothStream.mock.results[0]!.value
    )
  })

  it('uses low reasoning effort for reasoning models in answer-first scenes', () => {
    getSolutionStream([])

    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: {
          openai: {
            reasoningEffort: 'low'
          }
        }
      })
    )
  })

  it('does not override reasoning effort for coding or non-reasoning models', () => {
    mocks.settings.activeSceneId = 'coding'
    getSolutionStream([])
    expect(mocks.streamText.mock.calls[0]![0]).not.toHaveProperty('providerOptions')

    mocks.streamText.mockClear()
    mocks.settings.activeSceneId = 'aptitude-test'
    mocks.settings.model = 'gpt-4o-mini'
    getSolutionStream([])
    expect(mocks.streamText.mock.calls[0]![0]).not.toHaveProperty('providerOptions')
  })

  it('uses the active scene model and prompt independently from global defaults', () => {
    mocks.settings.scenes[1].model = 'gpt-5-nano'

    getSolutionStream([])

    expect(mocks.chat).toHaveBeenCalledWith('gpt-5-nano')
    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'choice prompt'
      })
    )
  })

  it('splits buffered text without cutting Unicode code points', () => {
    expect(getSmoothStreamChunk('七字符abc')).toBeNull()
    expect(getSmoothStreamChunk('😀😀😀😀😀😀😀😀后续')).toBe('😀😀😀😀😀😀😀😀')
    expect(getSmoothStreamChunk('a'.repeat(120))).toBe('a'.repeat(24))
  })
})
