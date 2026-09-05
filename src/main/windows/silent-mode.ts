import { screen } from 'electron'
import type { BrowserWindow } from 'electron'

export type SilentModeWindow = Pick<
  BrowserWindow,
  | 'getPosition'
  | 'hide'
  | 'isDestroyed'
  | 'isVisible'
  | 'setAlwaysOnTop'
  | 'setContentProtection'
  | 'setIgnoreMouseEvents'
  | 'setOpacity'
  | 'setPosition'
  | 'setVisibleOnAllWorkspaces'
  | 'show'
  | 'showInactive'
>

let silentModeEnabled = false
let silentModeInitialized = false
const softHiddenPositions = new WeakMap<SilentModeWindow, [number, number]>()

type SilentModeTransitionOptions = {
  hideCompanionWindow?: () => void
  showCompanionWindow?: () => void
  ignoreMouseEvents?: boolean
}

export function isSilentModeEnabled(): boolean {
  return silentModeEnabled
}

export function setSilentModeEnabled(enabled: boolean): void {
  silentModeEnabled = enabled
  silentModeInitialized = true
}

export function applyContentProtection(window: SilentModeWindow, forceReset = false): void {
  if (window.isDestroyed()) return

  if (forceReset && process.platform === 'win32') {
    window.setContentProtection(false)
  }

  window.setContentProtection(true)
}

function getOffscreenPosition(): [number, number] {
  const displays = screen.getAllDisplays()
  const maxRight = Math.max(...displays.map((display) => display.bounds.x + display.bounds.width))
  const topMost = Math.min(...displays.map((display) => display.bounds.y))

  return [maxRight + 2000, topMost]
}

export function isMainWindowSoftHidden(window: SilentModeWindow): boolean {
  return softHiddenPositions.has(window)
}

export function concealMainWindow(window: SilentModeWindow): void {
  if (window.isDestroyed()) return

  if (process.platform !== 'win32') {
    if (window.isVisible()) window.hide()
    return
  }

  if (softHiddenPositions.has(window)) return
  softHiddenPositions.set(window, window.getPosition() as [number, number])
  window.setOpacity(0)
  window.setIgnoreMouseEvents(true)
  window.setPosition(...getOffscreenPosition())
}

export function applySilentMode(window: SilentModeWindow): void {
  if (!silentModeEnabled || window.isDestroyed() || !window.isVisible()) return
  concealMainWindow(window)
}

export function revealMainWindow(window: SilentModeWindow, ignoreMouseEvents = false): boolean {
  if (!silentModeInitialized || silentModeEnabled || window.isDestroyed()) return false

  applyContentProtection(window, process.platform === 'win32')
  window.setAlwaysOnTop(true, 'screen-saver', 1)
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  const softHiddenPosition = softHiddenPositions.get(window)
  if (process.platform === 'win32' && softHiddenPosition) {
    window.setPosition(...softHiddenPosition)
    window.setIgnoreMouseEvents(ignoreMouseEvents)
    window.setOpacity(1)
    softHiddenPositions.delete(window)
    return true
  }

  if (window.isVisible()) return true
  if (process.platform === 'darwin' || process.platform === 'win32') {
    window.showInactive()
  } else {
    window.show()
  }
  return true
}

export function transitionSilentMode(
  window: SilentModeWindow,
  enabled: boolean,
  options: SilentModeTransitionOptions = {}
): void {
  setSilentModeEnabled(enabled)
  if (enabled) {
    applySilentMode(window)
    options.hideCompanionWindow?.()
    return
  }

  if (revealMainWindow(window, options.ignoreMouseEvents)) {
    options.showCompanionWindow?.()
  }
}
