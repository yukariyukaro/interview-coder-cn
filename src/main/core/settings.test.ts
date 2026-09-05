import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  isMainWindowSender: vi.fn(() => true),
  configureMobileSync: vi.fn(),
  syncToolbarSettings: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.0.0'),
    dock: { hide: vi.fn(), show: vi.fn() }
  },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    })
  }
}))
vi.mock('../windows/toolbar-window', () => ({
  hideToolbar: vi.fn(),
  setToolbarOpacity: vi.fn(),
  showToolbar: vi.fn(),
  syncToolbarSettings: mocks.syncToolbarSettings
}))
vi.mock('../windows/silent-mode', () => ({ transitionSilentMode: vi.fn() }))
vi.mock('./ipc-sender', () => ({ isMainWindowSender: mocks.isMainWindowSender }))
vi.mock('./state', () => ({ state: { ignoreMouse: false } }))
vi.mock('../sync/mobile-sync', () => ({ configureMobileSync: mocks.configureMobileSync }))

import { sanitizeAppSettingsUpdate, settings } from './settings'

describe('settings IPC', () => {
  beforeEach(() => {
    mocks.isMainWindowSender.mockReturnValue(true)
    mocks.configureMobileSync.mockClear()
    mocks.syncToolbarSettings.mockClear()
    settings.colorMode = 'dark'
  })

  it('keeps only known settings with valid runtime types', () => {
    const malicious = JSON.parse(
      '{"syncEnabled":true,"syncServerUrl":"ws://localhost:8787","syncPairingCode":"0123456789abcdef0123456789abcdef","opacity":2,"toolbarHoverDelay":750,"unknown":"value","__proto__":{"polluted":true}}'
    )

    expect(sanitizeAppSettingsUpdate(malicious)).toEqual({
      syncEnabled: true,
      syncServerUrl: 'ws://localhost:8787',
      syncPairingCode: '0123456789abcdef0123456789abcdef'
    })
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
  })

  it('accepts complete scene configuration and rejects malformed scenes', () => {
    const scenes = [
      {
        id: 'aptitude-test',
        name: '能力测评',
        prompt: '直接回答选择题',
        model: 'gpt-5-mini',
        reasoningEffort: 'low',
        shortcut: 'Alt+P',
        isPreset: true
      }
    ]

    expect(sanitizeAppSettingsUpdate({ activeSceneId: 'aptitude-test', scenes })).toEqual({
      activeSceneId: 'aptitude-test',
      scenes
    })
    expect(
      sanitizeAppSettingsUpdate({
        scenes: [{ ...scenes[0], reasoningEffort: 'unsupported' }]
      })
    ).toEqual({})
  })

  it('accepts only supported color modes', () => {
    expect(sanitizeAppSettingsUpdate({ colorMode: 'light' })).toEqual({ colorMode: 'light' })
    expect(sanitizeAppSettingsUpdate({ colorMode: 'system' })).toEqual({})
  })

  it('pushes color mode changes to the independent toolbar renderer', () => {
    const handler = mocks.handlers.get('updateAppSettings')
    expect(handler).toBeTypeOf('function')

    expect(handler!({ sender: {} }, { colorMode: 'light' })).toBe(true)
    expect(mocks.syncToolbarSettings).toHaveBeenCalledWith(settings.toolbarHoverDelay, 'light')
  })

  it('rejects settings updates from a non-main renderer', () => {
    mocks.isMainWindowSender.mockReturnValue(false)
    const handler = mocks.handlers.get('updateAppSettings')
    expect(handler).toBeTypeOf('function')

    const result = handler!({ sender: {} }, { syncEnabled: true })

    expect(result).toBe(false)
    expect(settings.syncEnabled).toBe(false)
    expect(mocks.configureMobileSync).not.toHaveBeenCalled()
  })

  it('reconfigures mobile sync after an authorized settings update', () => {
    const handler = mocks.handlers.get('updateAppSettings')
    expect(handler).toBeTypeOf('function')

    const result = handler!(
      { sender: {} },
      {
        syncEnabled: true,
        syncServerUrl: 'ws://localhost:8787',
        syncPairingCode: '0123456789abcdef0123456789abcdef'
      }
    )

    expect(result).toBe(true)
    expect(mocks.configureMobileSync).toHaveBeenLastCalledWith({
      syncEnabled: true,
      syncServerUrl: 'ws://localhost:8787',
      syncPairingCode: '0123456789abcdef0123456789abcdef'
    })
  })
})
