import { globalShortcut, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import type { ModelMessage } from 'ai'
import {
  concealMainWindow,
  isMainWindowSoftHidden,
  isSilentModeEnabled,
  revealMainWindow,
  transitionSilentMode
} from './silent-mode'
import {
  showToolbar,
  hideToolbar,
  setToolbarWanted,
  reassertToolbarTopMost
} from './toolbar-window'
import { takeScreenshot } from './take-screenshot'
import { saveScreenshotToDisk } from './save-screenshot'
import { getSolutionStream, getFollowUpStream, getGeneralStream } from './ai'
import { state } from './state'
import { settings } from './settings'
import { getTranscriptionText, clearTranscriptionText } from './transcription'
import { isMainWindowSender, isTrustedWindowSender } from './ipc-sender'
import { solutionEventPublisher } from './solution-events'
import { sendMobileScrollCommand } from './mobile-sync'

/**
 * Extract meaningful error message from API errors
 */
function extractErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error) || '未知错误'
  }

  // Try to extract responseBody from AI SDK errors
  const apiError = error as Error & {
    responseBody?: string
    statusCode?: number
    data?: unknown
  }

  // Try to parse responseBody for detailed message
  if (apiError.responseBody) {
    try {
      const body = JSON.parse(apiError.responseBody)
      if (body.message) {
        return body.message
      }
      if (body.error?.message) {
        return body.error.message
      }
    } catch {
      // If parsing fails, use responseBody as is
      if (typeof apiError.responseBody === 'string' && apiError.responseBody.length < 200) {
        return apiError.responseBody
      }
    }
  }

  // Fallback to error message
  return error.message || '未知错误'
}

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

type AbortReason = 'user' | 'new-request'

interface StreamContext {
  controller: AbortController
  reason: AbortReason | null
}

let currentStreamContext: StreamContext | null = null
let requestGeneration = 0

// Conversation history tracking
let conversationMessages: ModelMessage[] = []
let recentScreenshots: string[] = [] // 最近截图，水平预览 (限5张)
/** Every screenshot in the current conversation, including the ones dropped from the preview */
let screenshotCount = 0
let hasAppendSeparator = false

const FRONT_REASSERT_DURATION = 8000
const FRONT_REASSERT_INTERVAL = 100
const FRONT_RELATIVE_LEVEL = 100
const BACKGROUND_GUARD_INTERVAL = 2000
let frontReassertTimer: NodeJS.Timeout | null = null
let backgroundGuardTimer: NodeJS.Timeout | null = null

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

function abortCurrentStream(reason: AbortReason): boolean {
  if (!currentStreamContext) return false
  currentStreamContext.reason = reason
  currentStreamContext.controller.abort()
  return true
}

function resetSolutionSession(mainWindow: BrowserWindow): void {
  solutionEventPublisher.resetSession()
  mainWindow.webContents.send('solution-clear')
}

function sendScreenshotUpdate(
  mainWindow: BrowserWindow,
  screenshots: string[],
  total: number
): void {
  mainWindow.webContents.send('screenshots-updated', screenshots, total)
  solutionEventPublisher.publish('screenshot.updated', { total })
}

function sendRequestStarted(mainWindow: BrowserWindow): void {
  mainWindow.webContents.send('ai-loading-start')
  solutionEventPublisher.publish('request.started', {})
}

function sendSolutionDelta(mainWindow: BrowserWindow, text: string): void {
  mainWindow.webContents.send('solution-chunk', text)
  solutionEventPublisher.publish('solution.delta', { text })
}

function sendRequestCompleted(mainWindow: BrowserWindow): void {
  mainWindow.webContents.send('solution-complete')
  solutionEventPublisher.publish('request.completed', {})
}

function sendRequestStopped(mainWindow: BrowserWindow): void {
  mainWindow.webContents.send('solution-stopped')
  solutionEventPublisher.publish('request.stopped', {})
}

function sendRequestFailed(mainWindow: BrowserWindow, message: string): void {
  mainWindow.webContents.send('solution-error', message)
  solutionEventPublisher.publish('request.failed', { message })
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

  takeScreenshot: async () => {
    const mainWindow = global.mainWindow
    if (!mainWindow || mainWindow.isDestroyed() || !state.inCoderPage || !settings.apiKey) return

    const captureGeneration = ++requestGeneration
    const replacedActiveRequest = abortCurrentStream('new-request')
    let loadingStarted = false
    const screenshotData = await takeScreenshot()
    if (captureGeneration !== requestGeneration) return
    if (!screenshotData && replacedActiveRequest) {
      solutionEventPublisher.publish('request.stopped', {})
    }
    if (screenshotData && mainWindow && !mainWindow.isDestroyed()) {
      saveScreenshotToDisk(screenshotData)
      const transcriptionText = getTranscriptionText()
      if (transcriptionText) {
        clearTranscriptionText()
        mainWindow.webContents.send('transcription-cleared')
      }
      conversationMessages = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: transcriptionText
                ? `这是语音转录内容：\n${transcriptionText}\n\n同时附上屏幕截图：`
                : '这是屏幕截图'
            },
            {
              type: 'image',
              image: screenshotData
            }
          ]
        }
      ]

      const streamContext: StreamContext = {
        controller: new AbortController(),
        reason: null
      }
      currentStreamContext = streamContext
      recentScreenshots = [screenshotData]
      screenshotCount = 1
      hasAppendSeparator = false
      resetSolutionSession(mainWindow)
      sendScreenshotUpdate(mainWindow, recentScreenshots, screenshotCount)
      mainWindow.webContents.send('screenshot-taken', screenshotData)
      sendRequestStarted(mainWindow)
      loadingStarted = true
      let endedNaturally = true
      let streamStarted = false
      let assistantResponse = ''
      try {
        const solutionStream = getSolutionStream(
          conversationMessages,
          streamContext.controller.signal
        )
        streamStarted = true
        try {
          for await (const chunk of solutionStream) {
            if (streamContext.controller.signal.aborted) {
              endedNaturally = false
              break
            }
            assistantResponse += chunk
            sendSolutionDelta(mainWindow, chunk)
          }
        } catch (error) {
          if (!streamContext.controller.signal.aborted) {
            endedNaturally = false
            console.error('Error streaming solution:', error)
            sendRequestFailed(mainWindow, extractErrorMessage(error))
          } else {
            endedNaturally = false
          }
        }

        if (streamContext.controller.signal.aborted) {
          if (streamContext.reason === 'user') {
            sendRequestStopped(mainWindow)
          }
        } else if (endedNaturally) {
          // Add assistant response to conversation history
          if (assistantResponse) {
            conversationMessages.push({
              role: 'assistant',
              content: assistantResponse
            })
          }
          sendRequestCompleted(mainWindow)
        }
      } catch (error) {
        if (streamContext.controller.signal.aborted) {
          if (streamContext.reason === 'user') {
            sendRequestStopped(mainWindow)
          }
        } else {
          endedNaturally = false
          console.error('Error streaming solution:', error)
          sendRequestFailed(mainWindow, extractErrorMessage(error))
        }
      } finally {
        const isCurrentStream = currentStreamContext === streamContext
        if (isCurrentStream) {
          currentStreamContext = null
        }
        if (!streamStarted && streamContext.reason === 'user') {
          sendRequestStopped(mainWindow)
        }
        if (isCurrentStream && loadingStarted && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ai-loading-end')
        }
      }
    }
  },

  // Append screenshot for continuous capture (if conversation exists)
  appendScreenshot: async () => {
    const mainWindow = global.mainWindow
    if (!mainWindow || mainWindow.isDestroyed() || !state.inCoderPage || !settings.apiKey) return

    // Fallback to first screenshot if no conversation
    if (conversationMessages.length === 0) {
      callbacks.takeScreenshot()
      return
    }

    const captureGeneration = ++requestGeneration
    const replacedActiveRequest = abortCurrentStream('new-request')
    let loadingStarted = false

    const screenshotData = await takeScreenshot()
    if (captureGeneration !== requestGeneration) return
    if (!screenshotData && replacedActiveRequest) {
      solutionEventPublisher.publish('request.stopped', {})
    }
    if (screenshotData && mainWindow && !mainWindow.isDestroyed()) {
      saveScreenshotToDisk(screenshotData)
      const transcriptionText = getTranscriptionText()
      if (transcriptionText) {
        clearTranscriptionText()
        mainWindow.webContents.send('transcription-cleared')
      }
      // Append new image message to conversation
      const newUserMessage: ModelMessage = {
        role: 'user',
        content: [
          {
            type: 'text',
            text: transcriptionText
              ? `这是下一部分截图和语音转录内容：\n${transcriptionText}\n请结合之前所有截图和分析，继续分析解答，不要遗漏任何信息。`
              : '这是下一部分截图，请结合之前所有截图和分析，继续分析解答，不要遗漏任何信息。'
          },
          {
            type: 'image',
            image: screenshotData
          }
        ]
      }
      conversationMessages.push(newUserMessage)

      const streamContext: StreamContext = {
        controller: new AbortController(),
        reason: null
      }
      currentStreamContext = streamContext

      recentScreenshots.push(screenshotData)
      recentScreenshots = recentScreenshots.slice(-5) // 限5张
      screenshotCount += 1
      mainWindow.webContents.send('screenshot-taken', screenshotData)
      sendScreenshotUpdate(mainWindow, recentScreenshots, screenshotCount)
      sendRequestStarted(mainWindow)
      if (!hasAppendSeparator) {
        sendSolutionDelta(mainWindow, '\n\n---\n\n')
        hasAppendSeparator = true
      } else {
        sendSolutionDelta(mainWindow, '\n\n')
      }
      loadingStarted = true

      let endedNaturally = true
      let streamStarted = false
      let assistantResponse = ''
      try {
        const solutionStream = getGeneralStream(
          conversationMessages,
          streamContext.controller.signal
        )
        streamStarted = true
        try {
          for await (const chunk of solutionStream) {
            if (streamContext.controller.signal.aborted) {
              endedNaturally = false
              break
            }
            assistantResponse += chunk
            sendSolutionDelta(mainWindow, chunk)
          }
        } catch (error) {
          if (!streamContext.controller.signal.aborted) {
            endedNaturally = false
            console.error('Error streaming continuous solution:', error)
            sendRequestFailed(mainWindow, extractErrorMessage(error))
          } else {
            endedNaturally = false
          }
        }

        if (streamContext.controller.signal.aborted) {
          if (streamContext.reason === 'user') {
            sendRequestStopped(mainWindow)
          }
        } else if (endedNaturally) {
          // Add assistant response to conversation history
          if (assistantResponse) {
            conversationMessages.push({
              role: 'assistant',
              content: assistantResponse
            })
          }
          sendRequestCompleted(mainWindow)
        }
      } catch (error) {
        if (streamContext.controller.signal.aborted) {
          if (streamContext.reason === 'user') {
            sendRequestStopped(mainWindow)
          }
        } else {
          endedNaturally = false
          console.error('Error streaming continuous solution:', error)
          sendRequestFailed(mainWindow, extractErrorMessage(error))
        }
      } finally {
        const isCurrentStream = currentStreamContext === streamContext
        if (isCurrentStream) {
          currentStreamContext = null
        }
        if (!streamStarted && streamContext.reason === 'user') {
          sendRequestStopped(mainWindow)
        }
        if (isCurrentStream && loadingStarted && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ai-loading-end')
        }
      }
    }
  },

  // Stop current AI solution stream
  stopSolutionStream: () => {
    requestGeneration += 1
    abortCurrentStream('user')
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
    mainWindow.webContents.send('scroll-page-up')
    sendMobileScrollCommand('up')
  },

  pageDown: () => {
    const mainWindow = global.mainWindow
    if (!mainWindow || mainWindow.isDestroyed() || !state.inCoderPage) return
    mainWindow.webContents.send('scroll-page-down')
    sendMobileScrollCommand('down')
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

function registerShortcut(action: string, key: string) {
  if (shortcuts[action]) {
    unregisterShortcut(action)
  }

  const keysToRegister = getShortcutRegistrationKeys(key)
  const registeredKeys: string[] = []
  keysToRegister.forEach((shortcutKey) => {
    if (globalShortcut.register(shortcutKey, callbacks[action])) {
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
  (event, shortcuts: Record<string, { action: string; key: string }>) => {
    if (!isMainWindowSender(event.sender)) return false
    Object.entries(shortcuts).forEach(([action, { key }]) => {
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
  if (!currentStreamContext) return false
  abortCurrentStream('user')
  return true
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
  const mainWindow = global.mainWindow
  if (
    typeof question !== 'string' ||
    !question.trim() ||
    !mainWindow ||
    mainWindow.isDestroyed() ||
    !state.inCoderPage ||
    !settings.apiKey
  ) {
    return { success: false, error: 'Invalid state' }
  }

  // Validate that there's an active conversation
  if (conversationMessages.length === 0) {
    return { success: false, error: 'No active conversation' }
  }

  requestGeneration += 1
  abortCurrentStream('new-request')
  const streamContext: StreamContext = {
    controller: new AbortController(),
    reason: null
  }
  currentStreamContext = streamContext

  solutionEventPublisher.publish('request.started', {})
  // Add a separator before the follow-up response
  sendSolutionDelta(mainWindow, '\n\n---\n\n')

  let endedNaturally = true
  let streamStarted = false
  let assistantResponse = ''

  try {
    const followUpStream = getFollowUpStream(
      conversationMessages,
      question,
      streamContext.controller.signal
    )
    streamStarted = true

    try {
      for await (const chunk of followUpStream) {
        if (streamContext.controller.signal.aborted) {
          endedNaturally = false
          break
        }
        assistantResponse += chunk
        sendSolutionDelta(mainWindow, chunk)
      }
    } catch (error) {
      if (!streamContext.controller.signal.aborted) {
        endedNaturally = false
        console.error('Error streaming follow-up solution:', error)
        sendRequestFailed(mainWindow, extractErrorMessage(error))
      } else {
        endedNaturally = false
      }
    }

    if (streamContext.controller.signal.aborted) {
      if (streamContext.reason === 'user') {
        sendRequestStopped(mainWindow)
      }
    } else if (endedNaturally) {
      // Update conversation history with user question and assistant response
      conversationMessages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: question
          }
        ]
      })
      if (assistantResponse) {
        conversationMessages.push({
          role: 'assistant',
          content: assistantResponse
        })
      }
      sendRequestCompleted(mainWindow)
    }
  } catch (error) {
    if (streamContext.controller.signal.aborted) {
      if (streamContext.reason === 'user') {
        sendRequestStopped(mainWindow)
      }
    } else {
      endedNaturally = false
      console.error('Error streaming follow-up solution:', error)
      sendRequestFailed(mainWindow, extractErrorMessage(error))
    }
  } finally {
    if (currentStreamContext === streamContext) {
      currentStreamContext = null
    }
    if (!streamStarted && streamContext.reason === 'user') {
      sendRequestStopped(mainWindow)
    }
  }

  return { success: true }
})
