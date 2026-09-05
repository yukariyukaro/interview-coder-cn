const DEFAULT_FLUSH_INTERVAL_MS = 40

type TimerHandle = unknown

type SolutionDeltaBufferOptions = {
  onFlush: (text: string) => void
  flushIntervalMs?: number
  setTimer?: (callback: () => void, delay: number) => TimerHandle
  clearTimer?: (handle: TimerHandle) => void
}

export type SolutionDeltaBuffer = {
  push(text: string): void
  flush(): void
  clear(): void
}

export function createSolutionDeltaBuffer({
  onFlush,
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}: SolutionDeltaBufferOptions): SolutionDeltaBuffer {
  let pendingText = ''
  let flushTimer: TimerHandle | null = null

  function cancelTimer(): void {
    if (flushTimer === null) return
    clearTimer(flushTimer)
    flushTimer = null
  }

  function flush(): void {
    cancelTimer()
    if (!pendingText) return
    const text = pendingText
    pendingText = ''
    onFlush(text)
  }

  return {
    push(text) {
      if (!text) return
      pendingText += text
      if (flushTimer !== null) return
      flushTimer = setTimer(flush, flushIntervalMs)
    },
    flush,
    clear() {
      cancelTimer()
      pendingText = ''
    }
  }
}
