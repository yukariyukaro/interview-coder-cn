import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { isMac } from '../utils/env'

export type Shortcut = {
  action: string
  /**
   * The accelerator. When it is built on a sacrificial right-side modifier
   * (`RightControl` / `RightAlt` / `RightShift`) the main process registers it
   * through the native hook, so the focused window never sees the keys. Otherwise it
   * goes through Electron's globalShortcut as before.
   */
  key: string
  defaultKey: string
  category: string
  status?: ShortcutStatus
}

export enum ShortcutStatus {
  Registered = 'registered',
  /** Handled by the native hook: the focused window never sees the keys */
  HookActive = 'hook-active',
  /** Hook unavailable, fell back to globalShortcut (may leak modifier keys) */
  Degraded = 'degraded',
  /** Neither the hook nor globalShortcut can express this binding */
  Unsupported = 'unsupported',
  Failed = 'failed',
  /** Shortcut is available to register but not registered. */
  Available = 'available'
}

interface ShortcutsState {
  shortcuts: Record<string, Shortcut>
}

interface ShortcutsStore extends ShortcutsState {
  updateShortcut: (action: string, shortcut: Shortcut) => void
  updateShortcuts: (shortcuts: Record<string, Shortcut>) => void
  resetShortcuts: () => void
}

type PersistedShortcutsState = {
  shortcuts?: Record<string, Shortcut>
}

function isPersistedShortcutsState(value: unknown): value is PersistedShortcutsState {
  return typeof value === 'object' && value !== null && 'shortcuts' in value
}

/**
 * Sacrificial prefixes.
 * `triggerPrefix` replaces `platformAlt`; on macOS an explicit CommandOrControl needs
 * a different sacrifice (right Command) so degrading stays key-for-key identical to
 * the defaults the app shipped before the hook.
 */
const triggerPrefix = isMac ? 'RightAlt' : 'RightControl'
const commandTriggerPrefix = isMac ? 'RightCommand' : 'RightControl'

const defaultShortcuts: Record<string, Omit<Shortcut, 'defaultKey'>> = {
  toggleSilentMode: {
    action: 'toggleSilentMode',
    key: `${triggerPrefix}+Shift+H`,
    category: 'Window Management'
  },
  hideOrShowMainWindow: {
    action: 'hideOrShowMainWindow',
    key: `${triggerPrefix}+H`,
    category: 'Window Management'
  },
  ignoreOrEnableMouse: {
    action: 'ignoreOrEnableMouse',
    key: `${triggerPrefix}+M`,
    category: 'Window Management'
  },
  increaseOpacity: {
    action: 'increaseOpacity',
    key: `${triggerPrefix}+Shift+Up`,
    category: 'Window Management'
  },
  decreaseOpacity: {
    action: 'decreaseOpacity',
    key: `${triggerPrefix}+Shift+Down`,
    category: 'Window Management'
  },
  appendScreenshot: {
    action: 'appendScreenshot',
    key: `${triggerPrefix}+Shift+Enter`,
    category: 'Screenshot & AI'
  },
  stopSolutionStream: {
    action: 'stopSolutionStream',
    key: `${triggerPrefix}+.`,
    category: 'Screenshot & AI'
  },
  toggleTranscription: {
    action: 'toggleTranscription',
    key: `${triggerPrefix}+T`,
    category: 'Screenshot & AI'
  },
  clearTranscription: {
    action: 'clearTranscription',
    key: `${triggerPrefix}+Shift+T`,
    category: 'Screenshot & AI'
  },
  pageUp: { action: 'pageUp', key: `${commandTriggerPrefix}+J`, category: 'Navigation' },
  pageDown: { action: 'pageDown', key: `${commandTriggerPrefix}+K`, category: 'Navigation' },
  pageLeft: { action: 'pageLeft', key: `${commandTriggerPrefix}+U`, category: 'Navigation' },
  pageRight: { action: 'pageRight', key: `${commandTriggerPrefix}+I`, category: 'Navigation' },
  moveMainWindowUp: {
    action: 'moveMainWindowUp',
    key: `${commandTriggerPrefix}+Up`,
    category: 'Window Movement'
  },
  moveMainWindowDown: {
    action: 'moveMainWindowDown',
    key: `${commandTriggerPrefix}+Down`,
    category: 'Window Movement'
  },
  moveMainWindowLeft: {
    action: 'moveMainWindowLeft',
    key: `${commandTriggerPrefix}+Left`,
    category: 'Window Movement'
  },
  moveMainWindowRight: {
    action: 'moveMainWindowRight',
    key: `${commandTriggerPrefix}+Right`,
    category: 'Window Movement'
  }
}

function buildDefaultShortcuts(): Record<string, Shortcut> {
  return Object.fromEntries(
    Object.entries(defaultShortcuts).map(([action, shortcut]) => [
      action,
      { ...shortcut, defaultKey: shortcut.key }
    ])
  )
}

/** True once the user changed the binding away from the shipped defaults */
export function isShortcutCustomized(shortcut: Shortcut): boolean {
  return shortcut.key !== shortcut.defaultKey
}

export const useShortcutsStore = create<ShortcutsStore>()(
  persist(
    (set) => ({
      shortcuts: buildDefaultShortcuts(),
      updateShortcut: (action, shortcut) => {
        set((state) => ({
          shortcuts: {
            ...state.shortcuts,
            [action]: shortcut
          }
        }))
      },
      updateShortcuts: (shortcuts) => {
        set({ shortcuts })
      },
      resetShortcuts: () => {
        set({ shortcuts: buildDefaultShortcuts() })
      }
    }),
    {
      name: 'interview-coder-shortcuts',
      version: 10,
      migrate: (state: unknown, version: number) => {
        if (!isPersistedShortcutsState(state) || !state.shortcuts) return state as ShortcutsStore
        // Merge in any new default shortcuts that are missing
        const defaults = buildDefaultShortcuts()
        const merged = {
          ...state,
          shortcuts: {
            ...defaults,
            ...state.shortcuts
          }
        } as ShortcutsStore
        delete merged.shortcuts.takeScreenshot

        // v2→v3: On Windows, migrate Alt shortcuts to CommandOrControl (Ctrl)
        if (version < 3 && !isMac) {
          for (const [action, shortcut] of Object.entries(merged.shortcuts)) {
            merged.shortcuts[action] = {
              ...shortcut,
              key: shortcut.key.replace(/\bAlt\b/g, 'CommandOrControl'),
              defaultKey: shortcut.defaultKey.replace(/\bAlt\b/g, 'CommandOrControl')
            }
          }
        }

        // v7→v8: untouched defaults move to the sacrificial right-side modifiers.
        // Bindings the user customised keep working as-is, and on a machine without
        // the native hook the new defaults degrade to the exact same physical keys
        // through `toFallbackAccelerator`.
        if (version < 8) {
          for (const [action, shortcut] of Object.entries(merged.shortcuts)) {
            const target = defaults[action]
            if (!target) continue
            if (shortcut.key !== shortcut.defaultKey) continue
            merged.shortcuts[action] = {
              ...shortcut,
              key: target.key,
              defaultKey: target.key
            }
          }
        }

        // v8→v9: an intermediate v8 shape kept the hook accelerator in a separate
        // `hookKey` field and left the legacy accelerator in `key`. That field is gone
        // and `key` carries the accelerator itself, so fold it back in.
        if (version < 9) {
          for (const [action, shortcut] of Object.entries(merged.shortcuts)) {
            const legacy = shortcut as Shortcut & { hookKey?: unknown }
            if (typeof legacy.hookKey !== 'string') continue
            const untouched = shortcut.key === shortcut.defaultKey
            const migrated: Shortcut & { hookKey?: unknown } = {
              ...legacy,
              key: untouched ? legacy.hookKey : shortcut.key,
              defaultKey: defaults[action]?.key ?? shortcut.defaultKey
            }
            delete migrated.hookKey
            merged.shortcuts[action] = migrated
          }
        }

        return merged
      }
    }
  )
)
