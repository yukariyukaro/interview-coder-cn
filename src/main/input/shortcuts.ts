import { globalShortcut, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import {
  concealMainWindow,
  isMainWindowSoftHidden,
  isSilentModeEnabled,
  revealMainWindow,
  transitionSilentMode
} from '../windows/silent-mode'
import {
  showToolbar,
  hideToolbar,
  setToolbarWanted,
  reassertToolbarTopMost
} from '../windows/toolbar-window'
import { state } from '../core/state'
import { settings } from '../core/settings'
import { clearTranscriptionText } from './transcription'
import { isMainWindowSender, isTrustedWindowSender } from '../core/ipc-sender'
import { sendMobileScrollCommand } from '../sync/mobile-sync'
import { createScrollInputController } from './scroll-input'
import {
  appendScreenshot,
  sendFollowUpQuestion,
  stopSolutionStream,
  takeNewScreenshot
} from '../solution/solution-controller'

type Shortcut = {
  action: string
  key: string
  status: ShortcutStatus
  registeredKeys: string[]
}

enum ShortcutStatus {
  Registered = 'registered',
  Failed = 'failed',
  /** Shortcut is available to register but not registered. */
  Available = 'available'
}

const MOVE_STEP = 200
/** Opacity delta per shortcut press, matching the settings slider step */
const OPACITY_STEP = 0.05
const shortcuts: Record<string, Shortcut> = {}

const FRONT_REASSERT_DURATION = 8000
const FRONT_REASSERT_INTERVAL = 100
const FRONT_RELATIVE_LEVEL = 100
const BACKGROUND_GUARD_INTERVAL = 2000
const SCENE_CAPTURE_ACTION_PREFIX = 'captureScene:'
let frontReassertTimer: NodeJS.Timeout | null = null
let backgroundGuardTimer: NodeJS.Timeout | null = null
const scrollInputController = createScrollInputController()

/**
 * Reassert always-on-top. `aggressive` also calls moveTop() which
 * brings the window above everything — only use on explicit user actions
 * (show, screenshot, etc.) to avoid disturbing interaction with other apps.
 */
function applyTopMost(win: BrowserWindow, aggressive = true) {
  if (!win || win.isDestroyed()) return
  win.setAlwaysOnTop(true, 'screen-saver', FRONT_RELATIVE_LEVEL)
  if (aggressive) win.moveTop()

  if (state.ignoreMouse) {
    reassertToolbarTopMost(FRONT_RELATIVE_LEVEL + 1, aggressive)
  }
}

/**
 * Start a persistent low-frequency background guard that continuously
 * re-asserts always-on-top while the window is visible.
 * Uses the non-aggressive variant so it won't steal focus or
 * interfere with the user's interaction with other windows.
 */
function startBackgroundGuard(window: BrowserWindow) {
  if (backgroundGuardTimer) return // already running
  backgroundGuardTimer = setInterval(() => {
    if (!window || window.isDestroyed() || !window.isVisible() || isMainWindowSoftHidden(window)) {
      stopBackgroundGuard()
      return
    }
    applyTopMost(window, false)
  }, BACKGROUND_GUARD_INTERVAL)
}

function stopBackgroundGuard() {
  if (backgroundGuardTimer) {
    clearInterval(backgroundGuardTimer)
    backgroundGuardTimer = null
  }
}

function stopFrontReassert() {
  if (frontReassertTimer) {
    clearInterval(frontReassertTimer)
    frontReassertTimer = null
  }
}

function showMainWindow(window: BrowserWindow) {
  if (!revealMainWindow(window, state.ignoreMouse)) return
  showToolbar()
  keepWindowInFront(window)
}

function keepWindowInFront(window: BrowserWindow) {
  if (!window || window.isDestroyed()) return
  if (frontReassertTimer) {
    clearInterval(frontReassertTimer)
    frontReassertTimer = null
  }

  const start = Date.now()
  const reassert = () => {
    if (!window.isVisible() || window.isDestroyed() || isMainWindowSoftHidden(window)) return false
    applyTopMost(window)
    return true
  }

  if (!reassert()) return

  // Aggressive burst: rapid reasserts for a short period
  frontReassertTimer = setInterval(() => {
    const shouldStop = Date.now() - start > FRONT_REASSERT_DURATION
    if (shouldStop || !reassert()) {
      if (frontReassertTimer) {
        clearInterval(frontReassertTimer)
        frontReassertTimer = null
      }
    }
  }, FRONT_REASSERT_INTERVAL)

  // Ensure background guard is running for persistent protection
  startBackgroundGuard(window)
}

/**
 * Opacity is owned by the renderer settings store (persisted + synced back to
 * main), so the shortcut only asks the renderer to step it.
 */
function adjustOpacity(delta: number) {
  const mainWindow = global.mainWindow
  if (!mainWindow || mainWindow.isDestroyed() || !state.inCoderPage) return
  mainWindow.webContents.send('adjust-opacity', delta)
}

function setSilentModeFromShortcut(mainWindow: BrowserWindow, enabled: boolean): void {
  settings.silentMode = enabled
  if (enabled) {
    stopFrontReassert()
    stopBackgroundGuard()
  }
  transitionSilentMode(mainWindow, enabled, {
    ignoreMouseEvents: state.ignoreMouse,
    hideCompanionWindow: hideToolbar,
    showCompanionWindow: showToolbar
  })
  mainWindow.webContents.send('silent-mode-changed', enabled)
  if (!enabled) keepWindowInFront(mainWindow)
}

function activateScene(mainWindow: BrowserWindow, sceneId: string): boolean {
  const scene = settings.scenes.find((candidate) => candidate.id === sceneId)
  if (!scene) return false

  settings.activeSceneId = scene.id
  settings.customPrompt = scene.prompt
  mainWindow.webContents.send('active-scene-changed', scene.id)
  return true
}

const callbacks: Record<string, () => void> = {
  toggleSilentMode: () => {
    const mainWindow = global.mainWindow
    if (!mainWindow || mainWindow.isDestroyed()) return

    setSilentModeFromShortcut(mainWindow, !isSilentModeEnabled())
  },

  hideOrShowMainWindow: async () => {
    const mainWindow = global.mainWindow
    if (!mainWindow || mainWindow.isDestroyed()) return

    if (isSilentModeEnabled()) {
      setSilentModeFromShortcut(mainWindow, false)
      return
    }

    if (process.platform === 'win32') {
      if (isMainWindowSoftHidden(mainWindow)) {
        showMainWindow(mainWindow)
        return
      }

      if (!mainWindow.isVisible()) {
        showMainWindow(mainWindow)
        return
      }

      stopFrontReassert()
      stopBackgroundGuard()
      concealMainWindow(mainWindow)
      hideToolbar()
      return
    }

    if (mainWindow.isVisible()) {
      stopBackgroundGuard()
      mainWindow.hide()
    } else {
      // 重新显示时不断重申置顶属性，抵消其他前台软件持续抢占
      showMainWindow(mainWindow)
    }
  },

  takeScreenshot: () => {
    void takeNewScreenshot()
  },

  appendScreenshot: () => {
    void appendScreenshot()
  },

  stopSolutionStream: () => {
    stopSolutionStream()
  },

  ignoreOrEnableMouse: () => {
    const mainWindow = global.mainWindow
    if (!mainWindow || mainWindow.isDestroyed() || !state.inCoderPage) return
    state.ignoreMouse = !state.ignoreMouse
    mainWindow.setIgnoreMouseEvents(state.ignoreMouse)
    showToolbar()
    mainWindow.webContents.send('sync-app-state', state)
  },

  increaseOpacity: () => {
    adjustOpacity(OPACITY_STEP)
  },

  decreaseOpacity: () => {
    adjustOpacity(-OPACITY_STEP)
  },

  pageUp: () => {
    const mainWindow = global.mainWindow
    if (!mainWindow || mainWindow.isDestroyed() || !state.inCoderPage) return
    const distanceRatio = scrollInputController.next('up')
    mainWindow.webContents.send('scroll-page-up', distanceRatio)
    sendMobileScrollCommand('up', distanceRatio)
  },

  pageDown: () => {
    const mainWindow = global.mainWindow
    if (!mainWindow || mainWindow.isDestroyed() || !state.inCoderPage) return
    const distanceRatio = scrollInputController.next('down')
    mainWindow.webContents.send('scroll-page-down', distanceRatio)
    sendMobileScrollCommand('down', distanceRatio)
  },

  pageLeft: () => {
    const mainWindow = global.mainWindow
    if (!mainWindow || mainWindow.isDestroyed() || !state.inCoderPage) return
    const distanceRatio = scrollInputController.next('left')
    mainWindow.webContents.send('scroll-page-left', distanceRatio)
  },

  pageRight: () => {
    const mainWindow = global.mainWindow
    if (!mainWindow || mainWindow.isDestroyed() || !state.inCoderPage) return
    const distanceRatio = scrollInputController.next('right')
    mainWindow.webContents.send('scroll-page-right', distanceRatio)
  },

  moveMainWindowUp: () => {
    const mainWindow = global.mainWindow
    if (!mainWindow || mainWindow.isDestroyed()) return
    const [x, y] = mainWindow.getPosition()
    mainWindow.setPosition(x, y - MOVE_STEP)
  },

  moveMainWindowDown: () => {
    const mainWindow = global.mainWindow
    if (!mainWindow || mainWindow.isDestroyed()) return
    const [x, y] = mainWindow.getPosition()
    mainWindow.setPosition(x, y + MOVE_STEP)
  },

  moveMainWindowLeft: () => {
    const mainWindow = global.mainWindow
    if (!mainWindow || mainWindow.isDestroyed()) return
    const [x, y] = mainWindow.getPosition()
    mainWindow.setPosition(x - MOVE_STEP, y)
  },

  moveMainWindowRight: () => {
    const mainWindow = global.mainWindow
    if (!mainWindow || mainWindow.isDestroyed()) return
    const [x, y] = mainWindow.getPosition()
    mainWindow.setPosition(x + MOVE_STEP, y)
  },

  toggleTranscription: () => {
    const mainWindow = global.mainWindow
    if (!mainWindow || mainWindow.isDestroyed() || !state.inCoderPage) return
    mainWindow.webContents.send('toggle-transcription')
  },

  clearTranscription: () => {
    const mainWindow = global.mainWindow
    if (!mainWindow || mainWindow.isDestroyed() || !state.inCoderPage) return
    clearTranscriptionText()
    mainWindow.webContents.send('transcription-cleared')
  }
}

const clickableActions = new Set([
  'takeScreenshot',
  'appendScreenshot',
  'stopSolutionStream',
  'ignoreOrEnableMouse',
  'increaseOpacity',
  'decreaseOpacity',
  'pageUp',
  'pageDown',
  'pageLeft',
  'pageRight',
  'moveMainWindowUp',
  'moveMainWindowDown',
  'moveMainWindowLeft',
  'moveMainWindowRight',
  'toggleTranscription',
  'clearTranscription'
])

function unregisterShortcut(action: string) {
  const shortcut = shortcuts[action]
  if (!shortcut) return
  if (shortcut.registeredKeys.length) {
    shortcut.registeredKeys.forEach((registeredKey) => {
      globalShortcut.unregister(registeredKey)
    })
  } else {
    globalShortcut.unregister(shortcut.key)
  }
  shortcut.status = ShortcutStatus.Available
  shortcut.registeredKeys = []
}

function getShortcutRegistrationKeys(key: string) {
  const keys = [key]
  if (process.platform !== 'win32') {
    return keys
  }
  const parts = key.split('+')
  const hasAlt = parts.includes('Alt')
  const hasCtrl = parts.includes('CommandOrControl') || parts.includes('Control')
  if (hasAlt && !hasCtrl) {
    const aliasParts = [...parts]
    const altIndex = aliasParts.indexOf('Alt')
    if (altIndex >= 0) {
      aliasParts.splice(altIndex, 0, 'CommandOrControl')
      const aliasKey = aliasParts.join('+')
      if (!keys.includes(aliasKey)) {
        keys.push(aliasKey)
      }
    }
  }
  return keys
}

function getSceneIdFromAction(action: string): string | null {
  if (!action.startsWith(SCENE_CAPTURE_ACTION_PREFIX)) return null
  try {
    return decodeURIComponent(action.slice(SCENE_CAPTURE_ACTION_PREFIX.length)) || null
  } catch {
    return null
  }
}

function getShortcutCallback(action: string): (() => void) | undefined {
  const callback = callbacks[action]
  if (callback) return callback

  const sceneId = getSceneIdFromAction(action)
  if (!sceneId) return undefined
  return () => {
    const mainWindow = global.mainWindow
    if (!mainWindow || mainWindow.isDestroyed() || !activateScene(mainWindow, sceneId)) return
    callbacks.takeScreenshot()
  }
}

function registerShortcut(action: string, key: string) {
  if (shortcuts[action]) {
    unregisterShortcut(action)
  }

  const callback = getShortcutCallback(action)
  if (!callback) return
  const keysToRegister = getShortcutRegistrationKeys(key)
  const registeredKeys: string[] = []
  keysToRegister.forEach((shortcutKey) => {
    if (globalShortcut.register(shortcutKey, callback)) {
      registeredKeys.push(shortcutKey)
    }
  })

  shortcuts[action] = {
    action,
    key,
    status: registeredKeys.length ? ShortcutStatus.Registered : ShortcutStatus.Failed,
    registeredKeys
  }
}

ipcMain.handle('getShortcuts', (event) => {
  if (!isMainWindowSender(event.sender)) return false
  return shortcuts
})

ipcMain.handle(
  'initShortcuts',
  (event, nextShortcuts: Record<string, { action: string; key: string }>) => {
    if (!isMainWindowSender(event.sender)) return false
    const nextActions = new Set(Object.keys(nextShortcuts))
    for (const action of Object.keys(shortcuts)) {
      if (nextActions.has(action)) continue
      unregisterShortcut(action)
      delete shortcuts[action]
    }
    Object.entries(nextShortcuts).forEach(([action, { key }]) => {
      registerShortcut(action, key)
    })
    return true
  }
)

ipcMain.handle('updateShortcuts', (event, _shortcuts: { action: string; key: string }[]) => {
  if (!isMainWindowSender(event.sender)) return false
  _shortcuts.forEach((shortcut) => {
    if (shortcuts[shortcut.action]?.key !== shortcut.key) {
      registerShortcut(shortcut.action, shortcut.key)
    }
  })
  return true
})

ipcMain.handle('stopSolutionStream', (event) => {
  if (!isMainWindowSender(event.sender)) return false
  return stopSolutionStream()
})

ipcMain.handle('triggerAction', (event, action: string) => {
  if (!isTrustedWindowSender(event.sender)) return false
  if (!clickableActions.has(action)) return false
  callbacks[action]?.()
  return true
})

ipcMain.handle('setToolbarVisible', (event, visible: boolean) => {
  if (!isTrustedWindowSender(event.sender) || typeof visible !== 'boolean') return false
  setToolbarWanted(visible)
  return true
})

ipcMain.handle('sendFollowUpQuestion', async (event, question: string) => {
  if (!isMainWindowSender(event.sender)) {
    return { success: false, error: 'Unauthorized' }
  }
  return sendFollowUpQuestion(question)
})
