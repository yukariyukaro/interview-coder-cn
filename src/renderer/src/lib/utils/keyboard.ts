import { splitAccelerator, type PrefixToken } from '@interview-coder/shortcut-tokens'

import { isMac } from './env'

const supportedPhysicalKeys = [
  // A~Z
  'KeyA',
  'KeyB',
  'KeyC',
  'KeyD',
  'KeyE',
  'KeyF',
  'KeyG',
  'KeyH',
  'KeyI',
  'KeyJ',
  'KeyK',
  'KeyL',
  'KeyM',
  'KeyN',
  'KeyO',
  'KeyP',
  'KeyQ',
  'KeyR',
  'KeyS',
  'KeyT',
  'KeyU',
  'KeyV',
  'KeyW',
  'KeyX',
  'KeyY',
  'KeyZ',
  // 0~9
  'Digit0',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
  'Digit7',
  'Digit8',
  'Digit9',
  // F1~F12
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  // Arrow keys
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  // Space, Tab, Enter, Backspace, Escape
  'Enter',
  'Tab',
  'Space',
  'Backspace',
  'Escape',
  // Backquote, Minus, Equal, Backslash, BracketLeft, BracketRight, Semicolon, Quote, Comma, Period, Slash
  'Backquote',
  'Minus',
  'Equal',
  'Backslash',
  'BracketLeft',
  'BracketRight',
  'Semicolon',
  'Quote',
  'Comma',
  'Period',
  'Slash'
] as const
type SupportPhysicalKey = (typeof supportedPhysicalKeys)[number]

const modifierKeys = [
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight'
]

/**
 * Right-side modifiers double as the sacrificial hook prefixes. `MetaRight` (right
 * Command) only exists on macOS; on Windows the Meta key is the Windows key, which
 * is not a reasonable sacrifice.
 */
const PREFIX_CODES: Record<string, PrefixToken> = isMac
  ? {
      ControlRight: 'RightControl',
      AltRight: 'RightAlt',
      MetaRight: 'RightCommand',
      ShiftRight: 'RightShift'
    }
  : {
      ControlRight: 'RightControl',
      AltRight: 'RightAlt',
      ShiftRight: 'RightShift'
    }

/** Which DOM modifier flag a sacrificed prefix turns on while it is held down */
const PREFIX_MODIFIER_FLAG: Record<PrefixToken, 'ctrl' | 'alt' | 'shift' | 'meta'> = {
  RightControl: 'ctrl',
  RightAlt: 'alt',
  RightCommand: 'meta',
  RightShift: 'shift'
}

export type ShortcutRecordingOptions = {
  /** A sacrificial prefix the recorder already captured from a right-side modifier */
  recordingPrefix?: PrefixToken | null
}

export function isModifierKey(code: string) {
  return modifierKeys.includes(code)
}

/** The sacrificial prefix produced by a right-side modifier, if any */
export function getPrefixTokenForCode(code: string): PrefixToken | null {
  return PREFIX_CODES[code] ?? null
}

export function getShortcutAccelerator(
  event: KeyboardEvent,
  options: ShortcutRecordingOptions = {}
) {
  const keyCode = event.code
  if (isModifierKey(keyCode) || !supportedPhysicalKeys.includes(keyCode as SupportPhysicalKey)) {
    return null
  }

  const prefix = options.recordingPrefix ?? null
  const prefixFlag = prefix ? PREFIX_MODIFIER_FLAG[prefix] : null

  const modifiers: string[] = []
  // AltRight on Windows reports AltGraph and toggles ctrlKey, so treat it as plain Alt
  const isAltGraph =
    typeof event.getModifierState === 'function' && event.getModifierState('AltGraph')
  const isCtrlActive = event.ctrlKey && !isAltGraph
  const isAltActive = event.altKey || isAltGraph

  // The prefix key itself also sets its own modifier flag; it is already part of the
  // accelerator, so it must not be added a second time
  if (isCtrlActive && prefixFlag !== 'ctrl') modifiers.push(isMac ? 'Control' : 'CommandOrControl')
  if (isAltActive && prefixFlag !== 'alt') modifiers.push('Alt')
  if (event.shiftKey && prefixFlag !== 'shift') modifiers.push('Shift')
  if (event.metaKey && prefixFlag !== 'meta') modifiers.push(isMac ? 'CommandOrControl' : 'Meta')

  if (!prefix && modifiers.length === 0) return null

  const specialKeysMap = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    // Backquote, Minus, Equal, Backslash, BracketLeft, BracketRight, Semicolon, Quote, Comma, Period, Slash
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    Backslash: '\\',
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/'
  } as const

  let key = keyCode
  if (keyCode.startsWith('Key')) {
    key = keyCode.slice(3)
  }
  if (keyCode.startsWith('Digit')) {
    key = keyCode.slice(5)
  }
  if (keyCode in specialKeysMap) {
    key = specialKeysMap[keyCode as keyof typeof specialKeysMap]
  }
  return [...(prefix ? [prefix] : []), ...modifiers, key].join('+')
}

/** Accelerator tokens that act as modifiers, including the sacrificial prefixes */
const modifierLabels: Record<string, { mac: string; other: string }> = {
  Control: { mac: '⌃', other: 'Ctrl' },
  CommandOrControl: { mac: '⌘', other: 'Ctrl' },
  Alt: { mac: '⌥', other: 'Alt' },
  Shift: { mac: '⇧', other: 'Shift' },
  Meta: { mac: 'Meta', other: 'Meta' },
  RightControl: { mac: '右⌃', other: '右Ctrl' },
  RightAlt: { mac: '右⌥', other: '右Alt' },
  RightCommand: { mac: '右⌘', other: '右Ctrl' },
  RightShift: { mac: '右⇧', other: '右Shift' }
}

const keyLabels: Record<string, string> = {
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Enter: '↵'
}

export function getShortcutAcceleratorDisplay(accelerator: string) {
  const parts = splitAccelerator(accelerator)
  if (parts.length === 0) return ''

  const labels = parts
    .slice(0, -1)
    .map((token) => modifierLabels[token])
    .filter(Boolean)
    .map((label) => (isMac ? label.mac : label.other))

  const key = parts[parts.length - 1]
  return [...labels, keyLabels[key] ?? key].join('+')
}
