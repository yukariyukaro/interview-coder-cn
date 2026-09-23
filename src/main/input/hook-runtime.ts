import {
  isHookAccelerator,
  parseHookAccelerator,
  type Platform
} from '@interview-coder/shortcut-tokens'

import { loadNativeHook } from './native-addon'
import type { NativeBinding, NativeHookApi } from './native-addon.d'

/** IPC channel pushing hook availability changes to the renderer */
export const HOOK_STATUS_CHANGED = 'hook-status-changed'

const platform: Platform = process.platform === 'darwin' ? 'darwin' : 'win32'
const SUPPORTED_PLATFORMS = new Set(['win32', 'darwin'])

const HEALTH_INTERVAL_MS = 3000
/** Windows removes a low-level hook that keeps timing out, without telling anyone */
const HEALTH_SILENT_MS = 5000
const HEALTH_IDLE_MARGIN_MS = 1000

export type HookStatusReason =
  | 'ok'
  /** Addon available, but no binding currently uses a right-side modifier */
  | 'unused'
  | 'no-addon'
  | 'failed'
  | 'permission-denied'
  | 'unsupported-platform'

export type HookStatus = {
  available: boolean
  reason: HookStatusReason
  /** Number of bindings the hook is swallowing */
  hookedCount: number
}

export type HookBindingInput = { action: string; key: string }

export type HookBindingPlan = {
  /** Keyboard bindings handed to the addon */
  bindings: NativeBinding[]
  /** Actions served by the hook (the focused window sees nothing) */
  hooked: Set<string>
  /** Actions whose hook accelerator cannot be compiled on this platform */
  unsupported: Set<string>
}

export type HookRuntimeHandlers = {
  /** Run a shortcut action; reuses the very same callbacks as the system channel */
  dispatch: (action: string) => void
  /** Every registered binding, scene shortcuts included */
  getBindings: () => HookBindingInput[]
  /** The active channel changed: every binding has to be registered again */
  onChannelChanged: () => void
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'
/** macOS virtual keycodes, ANSI layout — verify on device when the addon is first built */
const MAC_LETTER_CODES = [
  0, 11, 8, 2, 14, 3, 5, 4, 34, 38, 40, 37, 46, 45, 31, 35, 12, 15, 1, 17, 32, 9, 13, 7, 16, 6
]
const MAC_DIGIT_CODES = [29, 18, 19, 20, 21, 23, 22, 26, 28, 25]
/** F16~F24 have no keycode on Apple keyboards */
const MAC_FUNCTION_CODES: Array<number | null> = [
  122,
  120,
  99,
  118,
  96,
  97,
  98,
  100,
  101,
  109,
  103,
  111,
  105,
  107,
  113,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null,
  null
]

const WIN_VK_SPECIAL: Record<string, number> = {
  Up: 0x26,
  Down: 0x28,
  Left: 0x25,
  Right: 0x27,
  Enter: 0x0d,
  Tab: 0x09,
  Space: 0x20,
  Backspace: 0x08,
  Escape: 0x1b,
  '`': 0xc0,
  '-': 0xbd,
  '=': 0xbb,
  '\\': 0xdc,
  '[': 0xdb,
  ']': 0xdd,
  ';': 0xba,
  "'": 0xde,
  ',': 0xbc,
  '.': 0xbe,
  '/': 0xbf,
  RightControl: 0xa3,
  RightAlt: 0xa5,
  RightShift: 0xa1
}

const MAC_CODE_SPECIAL: Record<string, number> = {
  Up: 126,
  Down: 125,
  Left: 123,
  Right: 124,
  Enter: 36,
  Tab: 48,
  Space: 49,
  Backspace: 51,
  Escape: 53,
  '`': 50,
  '-': 27,
  '=': 24,
  '\\': 42,
  '[': 33,
  ']': 30,
  ';': 41,
  "'": 39,
  ',': 43,
  '.': 47,
  '/': 44,
  RightControl: 62,
  RightAlt: 61,
  RightCommand: 54,
  RightShift: 60
}

/** Translate one accelerator key token into the platform keycode the addon expects */
export function resolveNativeKey(key: string, target: Platform = platform): number | null {
  if (key.length === 1) {
    const letterIndex = LETTERS.indexOf(key.toLowerCase())
    if (letterIndex >= 0) {
      return target === 'win32' ? 0x41 + letterIndex : MAC_LETTER_CODES[letterIndex]
    }
    if (/^[0-9]$/.test(key)) {
      const digit = Number(key)
      return target === 'win32' ? 0x30 + digit : MAC_DIGIT_CODES[digit]
    }
  }

  const functionKey = /^F(\d{1,2})$/.exec(key)
  if (functionKey) {
    const index = Number(functionKey[1]) - 1
    if (index < 0 || index > 23) return null
    return target === 'win32' ? 0x70 + index : MAC_FUNCTION_CODES[index]
  }

  return (target === 'win32' ? WIN_VK_SPECIAL : MAC_CODE_SPECIAL)[key] ?? null
}

/**
 * Compile an accelerator into the flat description the native state machine runs.
 * Returns null when the platform has no keycode for it, which marks the binding as
 * unsupported instead of silently registering something that never fires.
 */
export function compileHookBinding(
  action: string,
  accelerator: string,
  target: Platform = platform
): NativeBinding | null {
  const parsed = parseHookAccelerator(accelerator)
  if (!parsed) return null

  const prefixVk = resolveNativeKey(parsed.prefix, target)
  if (prefixVk === null) return null
  const finalVk = resolveNativeKey(parsed.key, target)
  if (finalVk === null) return null

  return { id: action, prefixVk, finalVk, ...parsed.modifiers }
}

let nativeHook: NativeHookApi | null = null
let handlers: HookRuntimeHandlers | null = null
let installed = false
let reason: HookStatusReason = 'no-addon'
let hookedCount = 0
let healthTimer: NodeJS.Timeout | null = null
/**
 * While true the hook stands down entirely. The sacrificial prefixes are swallowed
 * system-wide, our own settings window included, so the shortcut recorder could never
 * capture them; it asks for this while it is listening.
 */
let suspended = false

export function configureHookRuntime(next: HookRuntimeHandlers): void {
  handlers = next
}

/** True while the hook is actually swallowing keys */
export function isHookUsable(): boolean {
  return installed
}

/**
 * Hand the right-side modifiers back to the system. Used by the shortcut recorder,
 * which has to see the very keys the hook normally swallows.
 */
export function setHookSuspended(next: boolean): void {
  if (suspended === next) return
  suspended = next
  if (suspended) {
    uninstall()
    return
  }
  refreshHookBindings()
  handlers?.onChannelChanged()
}

export function initHookRuntime(): void {
  if (!SUPPORTED_PLATFORMS.has(process.platform)) {
    reason = 'unsupported-platform'
    return
  }
  nativeHook = loadNativeHook()
  reason = nativeHook ? 'unused' : 'no-addon'
}

function broadcastStatus(): void {
  const mainWindow = global.mainWindow
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(HOOK_STATUS_CHANGED, getHookStatus())
}

function install(): boolean {
  if (!SUPPORTED_PLATFORMS.has(process.platform)) {
    reason = 'unsupported-platform'
    return false
  }

  const api = nativeHook ?? loadNativeHook()
  nativeHook = api
  if (!api) {
    installed = false
    reason = 'no-addon'
    return false
  }

  api.setTriggerHandler((id) => handlers?.dispatch(id))
  if (!api.install({ bindings: [] })) {
    installed = false
    // On macOS the only realistic failure is a missing Accessibility / Input
    // Monitoring grant, so report that instead of a generic failure.
    reason = process.platform === 'darwin' ? 'permission-denied' : 'failed'
    return false
  }

  installed = true
  reason = 'ok'
  startHealthMonitor()
  return true
}

function uninstall(): void {
  stopHealthMonitor()
  if (nativeHook && installed) {
    try {
      nativeHook.uninstall()
    } catch {
      // The addon is optional; a failing teardown must not break shutdown
    }
  }
  installed = false
}

function startHealthMonitor(): void {
  if (healthTimer || process.platform !== 'win32') return
  healthTimer = setInterval(() => {
    if (!installed || !nativeHook) return
    let health: { hookSilentMs: number; systemIdleMs: number }
    try {
      health = nativeHook.getHealth()
    } catch {
      return
    }
    // The system saw input but our hook did not: Windows silently dropped it
    if (
      health.hookSilentMs > HEALTH_SILENT_MS &&
      health.systemIdleMs < health.hookSilentMs - HEALTH_IDLE_MARGIN_MS
    ) {
      uninstall()
      install()
      broadcastStatus()
      handlers?.onChannelChanged()
    }
  }, HEALTH_INTERVAL_MS)
}

function stopHealthMonitor(): void {
  if (!healthTimer) return
  clearInterval(healthTimer)
  healthTimer = null
}

/**
 * Compile the current configuration, install or tear the hook down accordingly, and
 * hand the bindings to the addon. Returns the plan so the registrar can label each
 * shortcut with its channel.
 *
 * Installing is driven purely by "does any binding use a right-side modifier" — using
 * one of those keys *is* what enables the hook, there is no separate switch.
 */
export function refreshHookBindings(): HookBindingPlan {
  const plan: HookBindingPlan = {
    bindings: [],
    hooked: new Set<string>(),
    unsupported: new Set<string>()
  }

  // Suspended: nothing is hooked right now, and the hook must not come back up
  if (suspended) {
    if (installed) uninstall()
    hookedCount = 0
    return plan
  }

  const inputs = handlers?.getBindings() ?? []
  for (const input of inputs) {
    if (!isHookAccelerator(input.key)) continue
    const binding = compileHookBinding(input.action, input.key)
    if (!binding) {
      plan.unsupported.add(input.action)
      continue
    }
    plan.bindings.push(binding)
    plan.hooked.add(input.action)
  }

  if (plan.bindings.length === 0) {
    if (installed) uninstall()
    const api = nativeHook ?? loadNativeHook()
    nativeHook = api
    if (!SUPPORTED_PLATFORMS.has(process.platform)) reason = 'unsupported-platform'
    else if (!api) reason = 'no-addon'
    else if (reason !== 'failed' && reason !== 'permission-denied') reason = 'unused'
    hookedCount = 0
    return plan
  }

  if (!installed && !install()) {
    hookedCount = 0
    return plan
  }

  try {
    nativeHook?.updateBindings({ bindings: plan.bindings })
  } catch {
    // Ignore: the health check will reinstall the hook
  }
  hookedCount = plan.hooked.size
  return plan
}

export function getHookStatus(): HookStatus {
  return { available: installed, reason, hookedCount }
}

export function disposeHookRuntime(): void {
  uninstall()
}
