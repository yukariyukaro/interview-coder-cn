import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  settings: {
    answerAutoSave: true,
    screenshotDir: '/tmp/interview-coder'
  }
}))

vi.mock('node:fs/promises', () => ({
  mkdir: mocks.mkdir,
  writeFile: mocks.writeFile
}))
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/pictures') }
}))
vi.mock('../core/settings', () => ({ settings: mocks.settings }))

import { createAnswerFilename, saveAnswerToDisk } from './save-answer'

describe('saveAnswerToDisk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.settings.answerAutoSave = true
    mocks.settings.screenshotDir = '/tmp/interview-coder'
  })

  it('writes the complete answer as UTF-8 Markdown', async () => {
    await saveAnswerToDisk('# 解答\n\n```ts\nconst answer = 42\n```', 'answer.md')

    expect(mocks.mkdir).toHaveBeenCalledWith('/tmp/interview-coder', { recursive: true })
    expect(mocks.writeFile).toHaveBeenCalledWith(
      '/tmp/interview-coder/answer.md',
      '# 解答\n\n```ts\nconst answer = 42\n```',
      'utf8'
    )
  })

  it('does not create a file when saving is disabled or the answer is empty', async () => {
    mocks.settings.answerAutoSave = false
    await saveAnswerToDisk('answer', 'answer.md')
    mocks.settings.answerAutoSave = true
    await saveAnswerToDisk('   ', 'answer.md')

    expect(mocks.mkdir).not.toHaveBeenCalled()
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('creates a stable Markdown filename from the session start time', () => {
    expect(createAnswerFilename(new Date(2026, 8, 10, 9, 8, 7, 6))).toBe(
      'answer_20260910_090807_006.md'
    )
  })
})
