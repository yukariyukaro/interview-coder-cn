import { describe, expect, it, vi } from 'vitest'

import { createSolutionDeltaBuffer } from './solution-delta-buffer'

function createHarness() {
  const scheduled: Array<() => void> = []
  const onFlush = vi.fn()
  const clearTimer = vi.fn()
  const buffer = createSolutionDeltaBuffer({
    onFlush,
    setTimer: (callback) => {
      scheduled.push(callback)
      return callback
    },
    clearTimer
  })
  return { buffer, clearTimer, onFlush, scheduled }
}

describe('createSolutionDeltaBuffer', () => {
  it('coalesces rapid deltas into one renderer update', () => {
    const { buffer, onFlush, scheduled } = createHarness()

    buffer.push('答案')
    buffer.push('：C')

    expect(scheduled).toHaveLength(1)
    expect(onFlush).not.toHaveBeenCalled()

    scheduled[0]()

    expect(onFlush).toHaveBeenCalledOnce()
    expect(onFlush).toHaveBeenCalledWith('答案：C')
  })

  it('flushes pending text before a terminal request event', () => {
    const { buffer, clearTimer, onFlush } = createHarness()

    buffer.push('部分答案')
    buffer.flush()

    expect(clearTimer).toHaveBeenCalledOnce()
    expect(onFlush).toHaveBeenCalledWith('部分答案')
  })

  it('drops buffered text when a new session replaces the current request', () => {
    const { buffer, onFlush, scheduled } = createHarness()

    buffer.push('旧答案')
    buffer.clear()
    scheduled[0]()

    expect(onFlush).not.toHaveBeenCalled()
  })
})
