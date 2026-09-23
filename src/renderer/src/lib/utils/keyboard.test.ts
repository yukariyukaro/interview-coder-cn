import { describe, expect, it } from 'vitest'
import { isMac, platform } from './env'
import {
  getPrefixTokenForCode,
  getShortcutAccelerator,
  getShortcutAcceleratorDisplay,
  isModifierKey
} from './keyboard'

const prefixModifier = isMac ? 'RightAlt' : 'RightControl'
const ctrlToken = isMac ? 'Control' : 'CommandOrControl'

type KeyEventInit = {
  code: string
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
}

function keyEvent(init: KeyEventInit): KeyboardEvent {
  return {
    code: init.code,
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
    metaKey: init.metaKey ?? false,
    getModifierState: () => false
  } as unknown as KeyboardEvent
}

describe('getPrefixTokenForCode', () => {
  it('maps right-side modifiers to the sacrificial prefixes', () => {
    expect(getPrefixTokenForCode('ControlRight')).toBe('RightControl')
    expect(getPrefixTokenForCode('AltRight')).toBe('RightAlt')
    expect(getPrefixTokenForCode('ShiftRight')).toBe('RightShift')
    expect(getPrefixTokenForCode('ControlLeft')).toBeNull()
    expect(getPrefixTokenForCode('KeyH')).toBeNull()
  })

  it('only treats right Command as a sacrifice on macOS', () => {
    expect(getPrefixTokenForCode('MetaRight')).toBe(isMac ? 'RightCommand' : null)
  })
})

describe('getShortcutAccelerator', () => {
  it('still requires a modifier for ordinary keys', () => {
    expect(getShortcutAccelerator(keyEvent({ code: 'KeyH' }))).toBeNull()
  })

  it('records plain modifiers as before', () => {
    expect(getShortcutAccelerator(keyEvent({ code: 'KeyH', ctrlKey: true }))).toBe(`${ctrlToken}+H`)
    expect(
      getShortcutAccelerator(keyEvent({ code: 'ArrowUp', shiftKey: true, ctrlKey: true }))
    ).toBe(`${ctrlToken}+Shift+Up`)
  })

  it('builds a hook accelerator from a captured prefix', () => {
    // Holding the right-side modifier also sets its own modifier flag; the recorder
    // must not emit it twice
    const withOwnFlag = isMac ? { code: 'KeyH', altKey: true } : { code: 'KeyH', ctrlKey: true }
    expect(getShortcutAccelerator(keyEvent(withOwnFlag), { recordingPrefix: prefixModifier })).toBe(
      `${prefixModifier}+H`
    )

    const withShift = isMac
      ? { code: 'KeyH', altKey: true, shiftKey: true }
      : { code: 'KeyH', ctrlKey: true, shiftKey: true }
    expect(getShortcutAccelerator(keyEvent(withShift), { recordingPrefix: prefixModifier })).toBe(
      `${prefixModifier}+Shift+H`
    )
  })
})

describe('getShortcutAcceleratorDisplay', () => {
  it('labels the sacrificial prefixes', () => {
    expect(getShortcutAcceleratorDisplay('RightControl+H')).toBe(isMac ? '右⌃+H' : '右Ctrl+H')
    expect(getShortcutAcceleratorDisplay('RightShift+Up')).toBe(isMac ? '右⇧+↑' : '右Shift+↑')
  })

  it('does not emit a leading plus for a modifier-free accelerator', () => {
    expect(getShortcutAcceleratorDisplay('F9')).toBe('F9')
    expect(getShortcutAcceleratorDisplay('')).toBe('')
  })

  it('keeps the platform-aware labels of plain accelerators', () => {
    expect(getShortcutAcceleratorDisplay('CommandOrControl+Shift+Enter')).toBe(
      isMac ? '⌘+⇧+↵' : 'Ctrl+Shift+↵'
    )
  })
})

describe('isModifierKey', () => {
  it('covers both sides', () => {
    expect(isModifierKey('ControlRight')).toBe(true)
    expect(isModifierKey('ShiftLeft')).toBe(true)
    expect(isModifierKey('KeyH')).toBe(false)
  })
})

describe('platform', () => {
  it('matches the renderer platform detection', () => {
    expect(platform).toBe(isMac ? 'darwin' : 'win32')
  })
})
