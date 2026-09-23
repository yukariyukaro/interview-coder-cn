import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toFallbackAccelerator } from '@interview-coder/shortcut-tokens'
import { isMac } from '../utils/env'
import { useShortcutsStore, type Shortcut } from './shortcuts'

/**
 * The accelerators the app shipped before the hook existed. Keeping them here makes
 * the "degrade to the original path" promise a machine-checked invariant: whatever the
 * defaults become, turning the native hook off must produce exactly these keys again.
 */
const legacyDefaults: Record<string, { win32: string; darwin: string }> = {
  toggleSilentMode: {
    win32: 'CommandOrControl+Shift+H',
    darwin: 'Alt+Shift+H'
  },
  hideOrShowMainWindow: { win32: 'CommandOrControl+H', darwin: 'Alt+H' },
  ignoreOrEnableMouse: { win32: 'CommandOrControl+M', darwin: 'Alt+M' },
  increaseOpacity: { win32: 'CommandOrControl+Shift+Up', darwin: 'Alt+Shift+Up' },
  decreaseOpacity: { win32: 'CommandOrControl+Shift+Down', darwin: 'Alt+Shift+Down' },
  toggleColorMode: { win32: 'CommandOrControl+Shift+D', darwin: 'Alt+Shift+D' },
  appendScreenshot: { win32: 'CommandOrControl+Shift+Enter', darwin: 'Alt+Shift+Enter' },
  stopSolutionStream: { win32: 'CommandOrControl+.', darwin: 'Alt+.' },
  toggleTranscription: { win32: 'CommandOrControl+T', darwin: 'Alt+T' },
  clearTranscription: { win32: 'CommandOrControl+Shift+T', darwin: 'Alt+Shift+T' },
  pageUp: { win32: 'CommandOrControl+J', darwin: 'CommandOrControl+J' },
  pageDown: { win32: 'CommandOrControl+K', darwin: 'CommandOrControl+K' },
  pageLeft: { win32: 'CommandOrControl+U', darwin: 'CommandOrControl+U' },
  pageRight: { win32: 'CommandOrControl+I', darwin: 'CommandOrControl+I' },
  moveMainWindowUp: { win32: 'CommandOrControl+Up', darwin: 'CommandOrControl+Up' },
  moveMainWindowDown: { win32: 'CommandOrControl+Down', darwin: 'CommandOrControl+Down' },
  moveMainWindowLeft: { win32: 'CommandOrControl+Left', darwin: 'CommandOrControl+Left' },
  moveMainWindowRight: { win32: 'CommandOrControl+Right', darwin: 'CommandOrControl+Right' }
}

const currentPlatform = isMac ? 'darwin' : 'win32'

describe('default shortcuts', () => {
  it('uses a sacrificial right-side modifier so the hook can swallow them', () => {
    const { shortcuts } = useShortcutsStore.getState()
    for (const shortcut of Object.values(shortcuts)) {
      expect(shortcut.key.startsWith(isMac ? 'RightAlt' : 'RightControl')).toBe(true)
    }
  })

  it('every default degrades key-for-key to its previous binding', () => {
    const { shortcuts } = useShortcutsStore.getState()
    for (const [action, shortcut] of Object.entries(shortcuts)) {
      expect(legacyDefaults[action]).toBeDefined()
      expect(toFallbackAccelerator(shortcut.key, currentPlatform)).toBe(
        legacyDefaults[action][currentPlatform]
      )
    }
  })
})

class MemoryStorage {
  private entries = new Map<string, string>()

  getItem(key: string) {
    return this.entries.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.entries.set(key, value)
  }
  removeItem(key: string) {
    this.entries.delete(key)
  }
}

describe('v7 -> v8 migration', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('localStorage', new MemoryStorage())
  })

  it('upgrades untouched defaults and leaves customised bindings alone', async () => {
    const untouched: Shortcut = {
      action: 'hideOrShowMainWindow',
      key: 'CommandOrControl+H',
      defaultKey: 'CommandOrControl+H',
      category: 'Window Management'
    }
    const customised: Shortcut = {
      action: 'pageUp',
      key: 'Control+Shift+P',
      defaultKey: 'CommandOrControl+J',
      category: 'Navigation'
    }
    localStorage.setItem(
      'interview-coder-shortcuts',
      JSON.stringify({
        state: {
          shortcuts: {
            [untouched.action]: untouched,
            [customised.action]: customised
          }
        },
        version: 7
      })
    )

    const { useShortcutsStore: freshStore } = await import('./shortcuts')
    const { shortcuts } = freshStore.getState()

    // Untouched: moved to the sacrificial prefix
    expect(shortcuts.hideOrShowMainWindow.key).not.toBe('CommandOrControl+H')
    expect(toFallbackAccelerator(shortcuts.hideOrShowMainWindow.key, currentPlatform)).toBe(
      'CommandOrControl+H'
    )

    // Customised: untouched, still registered through globalShortcut
    expect(shortcuts.pageUp.key).toBe('Control+Shift+P')
    expect(shortcuts.pageUp.defaultKey).toBe('CommandOrControl+J')

    vi.unstubAllGlobals()
  })
})

describe('v8 -> v9 migration', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('localStorage', new MemoryStorage())
  })

  it('folds the interim hookKey back into key', async () => {
    // The interim v8 shape kept the hook accelerator apart and left the legacy
    // accelerator in `key`, which silently disabled the hook for those bindings.
    const withHookKey = {
      action: 'hideOrShowMainWindow',
      key: 'CommandOrControl+H',
      defaultKey: 'CommandOrControl+H',
      hookKey: isMac ? 'RightAlt+H' : 'RightControl+H',
      category: 'Window Management'
    }
    localStorage.setItem(
      'interview-coder-shortcuts',
      JSON.stringify({
        state: { shortcuts: { [withHookKey.action]: withHookKey } },
        version: 8
      })
    )

    const { useShortcutsStore: freshStore } = await import('./shortcuts')
    const migrated = freshStore.getState().shortcuts.hideOrShowMainWindow

    expect(migrated.key).toBe(withHookKey.hookKey)
    expect(migrated.key.startsWith(isMac ? 'RightAlt' : 'RightControl')).toBe(true)
    expect(migrated.defaultKey).toBe(withHookKey.hookKey)
    expect('hookKey' in migrated).toBe(false)

    vi.unstubAllGlobals()
  })
})
