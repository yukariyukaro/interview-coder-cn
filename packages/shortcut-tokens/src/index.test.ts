import { describe, expect, it } from 'vitest'
import {
  getEffectiveAccelerator,
  getHookPrefix,
  hasModifierToken,
  isHookAccelerator,
  isHookToken,
  parseHookAccelerator,
  resolveShortcutChannel,
  splitAccelerator,
  toFallbackAccelerator
} from './index'

describe('vocabulary', () => {
  it('recognises the sacrificial right-side modifiers', () => {
    expect(isHookToken('RightControl')).toBe(true)
    expect(isHookToken('RightAlt')).toBe(true)
    expect(isHookToken('RightCommand')).toBe(true)
    expect(isHookToken('RightShift')).toBe(true)

    expect(isHookToken('Control')).toBe(false)
    expect(isHookToken('F9')).toBe(false)
    expect(isHookToken('H')).toBe(false)
  })

  it('splits accelerators', () => {
    expect(splitAccelerator('RightControl+Shift+H')).toEqual(['RightControl', 'Shift', 'H'])
    expect(splitAccelerator('  RightAlt+H ')).toEqual(['RightAlt', 'H'])
    expect(splitAccelerator('')).toEqual([])
  })

  it('detects modifier-bearing accelerators', () => {
    expect(hasModifierToken('CommandOrControl+H')).toBe(true)
    expect(hasModifierToken('RightControl+H')).toBe(true)
    expect(hasModifierToken('F9')).toBe(false)
  })
})

describe('parseHookAccelerator', () => {
  it('parses a prefix binding with and without extra modifiers', () => {
    expect(parseHookAccelerator('RightControl+J')).toEqual({
      prefix: 'RightControl',
      key: 'J',
      modifiers: { ctrl: false, alt: false, shift: false, meta: false }
    })
    expect(parseHookAccelerator('RightControl+Shift+H')).toEqual({
      prefix: 'RightControl',
      key: 'H',
      modifiers: { ctrl: false, alt: false, shift: true, meta: false }
    })
    expect(parseHookAccelerator('RightControl+.')).toMatchObject({ key: '.' })
    expect(parseHookAccelerator('RightCommand+Up')).toMatchObject({ key: 'Up' })
    expect(getHookPrefix('RightAlt+T')).toBe('RightAlt')
  })

  it('rejects shapes that would leak a modifier', () => {
    // No hook token at all -> system channel
    expect(parseHookAccelerator('CommandOrControl+H')).toBeNull()
    // A prefix needs a final key
    expect(parseHookAccelerator('RightControl')).toBeNull()
    // Two prefixes are ambiguous
    expect(parseHookAccelerator('RightControl+RightAlt+H')).toBeNull()
    // Two final keys are ambiguous
    expect(parseHookAccelerator('RightControl+H+J')).toBeNull()
    expect(parseHookAccelerator('')).toBeNull()
  })

  it('drives isHookAccelerator', () => {
    expect(isHookAccelerator('RightControl+H')).toBe(true)
    expect(isHookAccelerator('RightShift+Up')).toBe(true)
    expect(isHookAccelerator('CommandOrControl+H')).toBe(false)
    expect(isHookAccelerator('F9')).toBe(false)
  })
})

describe('toFallbackAccelerator', () => {
  it('maps a sacrificial prefix back to the pre-hook modifier (Windows)', () => {
    expect(toFallbackAccelerator('RightControl+H', 'win32')).toBe('CommandOrControl+H')
    expect(toFallbackAccelerator('RightControl+Shift+Up', 'win32')).toBe(
      'CommandOrControl+Shift+Up'
    )
    expect(toFallbackAccelerator('RightControl+.', 'win32')).toBe('CommandOrControl+.')
    expect(toFallbackAccelerator('RightShift+.', 'win32')).toBe('Shift+.')
  })

  it('maps a sacrificial prefix back to the pre-hook modifier (macOS)', () => {
    expect(toFallbackAccelerator('RightAlt+H', 'darwin')).toBe('Alt+H')
    expect(toFallbackAccelerator('RightCommand+J', 'darwin')).toBe('CommandOrControl+J')
    expect(toFallbackAccelerator('RightControl+H', 'darwin')).toBe('Control+H')
  })

  it('leaves plain system accelerators untouched', () => {
    expect(toFallbackAccelerator('CommandOrControl+H', 'win32')).toBe('CommandOrControl+H')
    expect(toFallbackAccelerator('Control+J', 'darwin')).toBe('Control+J')
    expect(toFallbackAccelerator('', 'win32')).toBeNull()
  })
})

describe('channel resolution', () => {
  it('uses the hook when it is available and the binding is a hook binding', () => {
    expect(resolveShortcutChannel('RightControl+H', true, 'win32')).toBe('hook')
    expect(resolveShortcutChannel('RightControl+H', false, 'win32')).toBe('system')
    expect(resolveShortcutChannel('CommandOrControl+H', true, 'win32')).toBe('system')
    expect(resolveShortcutChannel('', false, 'win32')).toBe('unsupported')
  })

  it('reports the accelerator that is actually active', () => {
    expect(getEffectiveAccelerator('RightControl+H', 'hook', 'win32')).toBe('RightControl+H')
    expect(getEffectiveAccelerator('RightControl+H', 'system', 'win32')).toBe('CommandOrControl+H')
  })
})
