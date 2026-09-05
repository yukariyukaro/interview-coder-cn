import {
  CONTINUOUS_SCROLL_DISTANCE_RATIO,
  DEFAULT_SCROLL_DISTANCE_RATIO,
  type ScrollDirection
} from '@interview-coder/sync-protocol'

const DEFAULT_REPEAT_WINDOW_MS = 700

type TimerHandle = ReturnType<typeof setTimeout>

export type ScrollInputControllerOptions = {
  now?: () => number
  setTimer?: (callback: () => void, delay: number) => TimerHandle
  clearTimer?: (handle: TimerHandle) => void
  repeatWindowMs?: number
}

export type ScrollInputController = {
  next(direction: ScrollDirection): number
  reset(): void
}

/**
 * Converts OS key-repeat callbacks into a full page followed by small wheel-like steps.
 * Electron globalShortcut does not expose keyup, so the repeat window is reset by debounce.
 */
export function createScrollInputController(
  options: ScrollInputControllerOptions = {}
): ScrollInputController {
  const now = options.now ?? Date.now
  const setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay))
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle))
  const repeatWindowMs = options.repeatWindowMs ?? DEFAULT_REPEAT_WINDOW_MS

  let lastDirection: ScrollDirection | null = null
  let lastTriggeredAt = -Infinity
  let resetTimer: TimerHandle | null = null

  function reset(): void {
    if (resetTimer !== null) {
      clearTimer(resetTimer)
      resetTimer = null
    }
    lastDirection = null
    lastTriggeredAt = -Infinity
  }

  function scheduleReset(): void {
    if (resetTimer !== null) clearTimer(resetTimer)
    resetTimer = setTimer(reset, repeatWindowMs)
  }

  return {
    next(direction) {
      const currentTime = now()
      const isRepeat =
        lastDirection === direction && currentTime - lastTriggeredAt <= repeatWindowMs
      lastDirection = direction
      lastTriggeredAt = currentTime
      scheduleReset()
      return isRepeat ? CONTINUOUS_SCROLL_DISTANCE_RATIO : DEFAULT_SCROLL_DISTANCE_RATIO
    },
    reset
  }
}
