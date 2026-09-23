/**
 * Shared vocabulary for the sacrificial right-side modifiers.
 *
 * An accelerator built on one of these tokens is registered through the native
 * low-level hook (src/main/input/hook-runtime.ts) instead of Electron's
 * globalShortcut, so every key of the sequence is swallowed before the focused
 * window — i.e. the browser — can see it. Anything else keeps using globalShortcut,
 * which leaks an orphan modifier press the page can observe.
 *
 * Using one of these tokens *is* what enables the feature: there is no separate
 * switch. When the native hook is unavailable the accelerator degrades through
 * `toFallbackAccelerator` to the equivalent left-side modifier, which is exactly the
 * binding the user had before, so nothing stops working.
 *
 * This module is the single source of truth for both processes: a drift here would
 * silently fall back to the leaking channel, so it must not be duplicated.
 */

export type Platform = 'win32' | 'darwin'

/**
 * Sacrificial modifiers. While the hook is active the key is taken over completely
 * and can no longer be used as Ctrl / Option / Command.
 */
export const PREFIX_TOKENS = ['RightControl', 'RightAlt', 'RightCommand', 'RightShift'] as const

export type PrefixToken = (typeof PREFIX_TOKENS)[number]

const PREFIX_TOKEN_SET: ReadonlySet<string> = new Set<string>(PREFIX_TOKENS)

/** Accelerator spellings Electron and our recorder can emit as holding modifiers. */
const CTRL_ALIASES = ['CommandOrControl', 'CmdOrCtrl', 'Control', 'Ctrl']
const ALT_ALIASES = ['Alt', 'AltGr', 'Option']
const SHIFT_ALIASES = ['Shift', 'ShiftLeft', 'ShiftRight']
const META_ALIASES = ['Meta', 'Super', 'Command', 'Cmd']

export type HookModifiers = {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

export type ParsedHookAccelerator = {
  prefix: PrefixToken
  /** The final key, in accelerator spelling (e.g. `J`, `Up`, `.`, `Enter`) */
  key: string
  modifiers: HookModifiers
}

export function splitAccelerator(accelerator: string): string[] {
  return accelerator
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
}

export function isHookToken(token: string): boolean {
  return PREFIX_TOKEN_SET.has(token)
}

function isModifierAlias(token: string): boolean {
  return (
    CTRL_ALIASES.includes(token) ||
    ALT_ALIASES.includes(token) ||
    SHIFT_ALIASES.includes(token) ||
    META_ALIASES.includes(token)
  )
}

function readModifiers(tokens: string[]): HookModifiers {
  return {
    ctrl: tokens.some((token) => CTRL_ALIASES.includes(token)),
    alt: tokens.some((token) => ALT_ALIASES.includes(token)),
    shift: tokens.some((token) => SHIFT_ALIASES.includes(token)),
    meta: tokens.some((token) => META_ALIASES.includes(token))
  }
}

/**
 * Parse an accelerator into a hook binding.
 *
 * The only accepted shape is one sacrificial prefix + optional plain modifiers + one
 * key (`RightControl+Shift+H`). Anything else returns null and stays on the system
 * channel. Keeping the shape this narrow is what lets the native state machine
 * swallow the whole key sequence with no orphan modifier reaching the browser.
 */
export function parseHookAccelerator(accelerator: string): ParsedHookAccelerator | null {
  const parts = splitAccelerator(accelerator)
  if (parts.length === 0) return null

  const prefixes = parts.filter((part) => isHookToken(part))
  if (prefixes.length !== 1) return null

  const prefix = prefixes[0] as PrefixToken
  const rest = parts.filter((part) => part !== prefix)
  if (rest.length === 0) return null
  if (rest.some((part) => isHookToken(part))) return null

  const keys = rest.filter((part) => !isModifierAlias(part))
  if (keys.length !== 1) return null

  return { prefix, key: keys[0], modifiers: readModifiers(rest) }
}

export function isHookAccelerator(accelerator: string): boolean {
  return parseHookAccelerator(accelerator) !== null
}

export function getHookPrefix(accelerator: string): PrefixToken | null {
  return parseHookAccelerator(accelerator)?.prefix ?? null
}

/**
 * True when the accelerator holds a modifier, i.e. registering it through
 * globalShortcut would leak an orphan modifier press to the focused window.
 */
export function hasModifierToken(accelerator: string): boolean {
  return splitAccelerator(accelerator).some((token) => isModifierAlias(token) || isHookToken(token))
}

const FALLBACK_MODIFIERS: Record<Platform, Record<PrefixToken, string>> = {
  win32: {
    RightControl: 'CommandOrControl',
    RightAlt: 'Alt',
    RightCommand: 'CommandOrControl',
    RightShift: 'Shift'
  },
  darwin: {
    RightControl: 'Control',
    RightAlt: 'Alt',
    RightCommand: 'CommandOrControl',
    RightShift: 'Shift'
  }
}

/** Named keys shared by our recorder and Electron's accelerator vocabulary. */
const PLAIN_NAMED_KEYS: ReadonlySet<string> = new Set<string>([
  'Up',
  'Down',
  'Left',
  'Right',
  'Enter',
  'Tab',
  'Space',
  'Backspace',
  'Escape',
  '`',
  '-',
  '=',
  '\\',
  '[',
  ']',
  ';',
  "'",
  ',',
  '.',
  '/'
])

function isPlainKey(key: string): boolean {
  return /^[A-Za-z0-9]$/.test(key) || PLAIN_NAMED_KEYS.has(key)
}

/**
 * The system-channel equivalent of a hook accelerator, used whenever the native hook
 * is unavailable. This is the "fall back to the original path" guarantee.
 *
 * Invariant (covered by tests): for every built-in default,
 * `toFallbackAccelerator(defaultKey, platform)` equals the accelerator the app
 * shipped before the hook existed, so degrading is key-for-key identical.
 *
 * Returns null when globalShortcut cannot express the accelerator.
 */
export function toFallbackAccelerator(accelerator: string, platform: Platform): string | null {
  if (splitAccelerator(accelerator).length === 0) return null

  const parsed = parseHookAccelerator(accelerator)
  // Already a system accelerator
  if (!parsed) return accelerator
  if (!isPlainKey(parsed.key)) return null

  const mapped: string[] = [FALLBACK_MODIFIERS[platform][parsed.prefix]]
  if (parsed.modifiers.ctrl) mapped.push(platform === 'darwin' ? 'Control' : 'CommandOrControl')
  if (parsed.modifiers.alt) mapped.push('Alt')
  if (parsed.modifiers.shift) mapped.push('Shift')
  if (parsed.modifiers.meta) mapped.push(platform === 'darwin' ? 'CommandOrControl' : 'Meta')
  mapped.push(parsed.key)
  return mapped.join('+')
}

export type ShortcutChannel = 'hook' | 'system' | 'unsupported'

/**
 * Which channel a binding actually runs through. Shared by both processes so the
 * settings UI and the registrar never disagree about what is active.
 */
export function resolveShortcutChannel(
  accelerator: string,
  hookAvailable: boolean,
  platform: Platform
): ShortcutChannel {
  if (hookAvailable && isHookAccelerator(accelerator)) return 'hook'
  if (toFallbackAccelerator(accelerator, platform)) return 'system'
  return 'unsupported'
}

/** The accelerator that is actually active for a binding on the given channel */
export function getEffectiveAccelerator(
  accelerator: string,
  channel: ShortcutChannel,
  platform: Platform
): string {
  if (channel === 'hook') return accelerator
  return toFallbackAccelerator(accelerator, platform) ?? ''
}
