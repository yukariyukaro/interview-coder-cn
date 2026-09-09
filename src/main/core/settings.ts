import { app, dialog, ipcMain } from 'electron'
import {
  hideToolbar,
  setToolbarOpacity,
  showToolbar,
  syncToolbarSettings
} from '../windows/toolbar-window'
import { transitionSilentMode } from '../windows/silent-mode'
import { isMainWindowSender, isTrustedWindowSender } from './ipc-sender'
import { state } from './state'
import { configureMobileSync } from '../sync/mobile-sync'
import { getMobileSyncServerUrl } from '../sync/sync-network'

let silentModeSettingReceived = false

export type ReasoningEffort = 'default' | 'minimal' | 'low' | 'medium' | 'high'
export type ColorMode = 'light' | 'dark'

export type SceneSettings = {
  id: string
  name: string
  prompt: string
  apiBaseURL: string
  apiKey: string
  model: string
  reasoningEffort: ReasoningEffort
  shortcut: string
  isPreset: boolean
}

ipcMain.handle('getAppVersion', (event) => {
  if (!isMainWindowSender(event.sender)) return null
  return app.getVersion()
})

ipcMain.handle('getAppSettings', (event) => {
  if (!isTrustedWindowSender(event.sender)) return null
  return settings
})

ipcMain.handle('getMobileSyncServerUrl', (event, serverUrl: unknown) => {
  if (!isMainWindowSender(event.sender)) return null
  return typeof serverUrl === 'string' ? getMobileSyncServerUrl(serverUrl) : null
})

ipcMain.handle('updateAppSettings', (event, input: unknown) => {
  if (!isMainWindowSender(event.sender)) return false
  const update = sanitizeAppSettingsUpdate(input)

  const shouldApplySilentMode =
    typeof update.silentMode === 'boolean' &&
    (!silentModeSettingReceived || update.silentMode !== settings.silentMode)

  Object.assign(settings, update)
  if (shouldApplySilentMode) {
    silentModeSettingReceived = true
    if (global.mainWindow && !global.mainWindow.isDestroyed()) {
      transitionSilentMode(global.mainWindow, settings.silentMode, {
        hideCompanionWindow: hideToolbar,
        showCompanionWindow: showToolbar,
        ignoreMouseEvents: state.ignoreMouse
      })
    }
  }
  if ('hideDockIcon' in update) {
    applyDockVisibility(settings.hideDockIcon)
  }
  if ('opacity' in update) {
    setToolbarOpacity(settings.opacity)
  }
  if ('toolbarHoverDelay' in update || 'colorMode' in update) {
    syncToolbarSettings(settings.toolbarHoverDelay, settings.colorMode)
  }
  if ('syncEnabled' in update || 'syncServerUrl' in update || 'syncPairingCode' in update) {
    configureMobileSync({
      syncEnabled: settings.syncEnabled,
      syncServerUrl: settings.syncServerUrl,
      syncPairingCode: settings.syncPairingCode
    })
  }
  return true
})

/** Show/hide the macOS dock icon. No-op on other platforms. */
export function applyDockVisibility(hidden: boolean): void {
  if (process.platform !== 'darwin') return
  if (hidden) {
    app.dock?.hide()
  } else {
    app.dock?.show()
  }
}

ipcMain.handle('selectScreenshotDir', async (event) => {
  if (!isMainWindowSender(event.sender)) return null
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: '选择本地保存目录'
  })
  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  return result.filePaths[0]
})

export const settings = {
  apiBaseURL: process.env.API_BASE_URL || '',
  apiKey: process.env.API_KEY || '',
  model: process.env.MODEL || '',
  customPrompt: '',
  activeSceneId: 'coding',
  scenes: [] as SceneSettings[],
  /** Kept in sync with the renderer so the overlay toolbar can match the main window */
  opacity: 0.8,
  /**
   * Dwell time in ms before hovering a toolbar button fires it; 0 disables hover
   * triggering. The real default lives in the renderer store: App.tsx fills blank
   * renderer fields from here, so a truthy default would overwrite a user's "off".
   */
  toolbarHoverDelay: 0,
  colorMode: 'dark' as ColorMode,
  screenshotAutoSave: false,
  answerAutoSave: false,
  screenshotDir: '',
  dashscopeApiKey: '',
  hideDockIcon: false,
  silentMode: false,
  syncEnabled: false,
  syncServerUrl: '',
  syncPairingCode: '',
  audioInputDeviceId: '',
  audioOutputDeviceId: ''
}

export type AppSettings = typeof settings

export function getEffectiveAISettings(appSettings: AppSettings): {
  apiBaseURL: string
  apiKey: string
  model: string
} {
  const scene = appSettings.scenes.find((candidate) => candidate.id === appSettings.activeSceneId)
  return {
    apiBaseURL: scene?.apiBaseURL || appSettings.apiBaseURL,
    apiKey: scene?.apiKey || appSettings.apiKey,
    model: scene?.model || appSettings.model
  }
}

const reasoningEfforts = new Set<ReasoningEffort>(['default', 'minimal', 'low', 'medium', 'high'])

function isSceneSettingsArray(value: unknown): value is SceneSettings[] {
  return (
    Array.isArray(value) &&
    value.length <= 50 &&
    value.every(
      (scene) =>
        typeof scene === 'object' &&
        scene !== null &&
        typeof scene.id === 'string' &&
        scene.id.length > 0 &&
        scene.id.length <= 128 &&
        typeof scene.name === 'string' &&
        scene.name.length <= 100 &&
        typeof scene.prompt === 'string' &&
        scene.prompt.length <= 100_000 &&
        typeof scene.apiBaseURL === 'string' &&
        scene.apiBaseURL.length <= 2_048 &&
        typeof scene.apiKey === 'string' &&
        scene.apiKey.length <= 512 &&
        typeof scene.model === 'string' &&
        scene.model.length <= 256 &&
        typeof scene.shortcut === 'string' &&
        scene.shortcut.length <= 128 &&
        typeof scene.isPreset === 'boolean' &&
        reasoningEfforts.has(scene.reasoningEffort as ReasoningEffort)
    )
  )
}

const settingValidators: Record<keyof AppSettings, (value: unknown) => boolean> = {
  apiBaseURL: (value) => typeof value === 'string',
  apiKey: (value) => typeof value === 'string',
  model: (value) => typeof value === 'string',
  customPrompt: (value) => typeof value === 'string',
  activeSceneId: (value) => typeof value === 'string',
  scenes: isSceneSettingsArray,
  opacity: (value) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0.1 && value <= 1,
  toolbarHoverDelay: (value) => typeof value === 'number' && [0, 500, 1000, 2000].includes(value),
  colorMode: (value) => value === 'light' || value === 'dark',
  screenshotAutoSave: (value) => typeof value === 'boolean',
  answerAutoSave: (value) => typeof value === 'boolean',
  screenshotDir: (value) => typeof value === 'string',
  dashscopeApiKey: (value) => typeof value === 'string',
  hideDockIcon: (value) => typeof value === 'boolean',
  silentMode: (value) => typeof value === 'boolean',
  syncEnabled: (value) => typeof value === 'boolean',
  syncServerUrl: (value) => typeof value === 'string',
  syncPairingCode: (value) => typeof value === 'string',
  audioInputDeviceId: (value) => typeof value === 'string',
  audioOutputDeviceId: (value) => typeof value === 'string'
}

export function sanitizeAppSettingsUpdate(input: unknown): Partial<AppSettings> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}

  const update: Record<string, unknown> = {}
  for (const key of Object.keys(settingValidators) as Array<keyof AppSettings>) {
    const value = (input as Record<string, unknown>)[key]
    if (settingValidators[key](value)) update[key] = value
  }
  return update as Partial<AppSettings>
}
