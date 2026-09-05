import { describe, expect, it } from 'vitest'

import { getSceneCaptureAction, getSceneShortcuts } from './scene-shortcuts'

describe('scene shortcuts', () => {
  it('creates encoded actions only for scenes with shortcuts', () => {
    expect(
      getSceneShortcuts([
        { id: 'coding', shortcut: 'Alt+Enter' },
        { id: 'custom/math', shortcut: ' Control+P ' },
        { id: 'without-shortcut', shortcut: '' }
      ])
    ).toEqual({
      'captureScene:coding': {
        action: 'captureScene:coding',
        key: 'Alt+Enter'
      },
      'captureScene:custom%2Fmath': {
        action: 'captureScene:custom%2Fmath',
        key: 'Control+P'
      }
    })
  })

  it('encodes scene identifiers in global shortcut action names', () => {
    expect(getSceneCaptureAction('custom/math test')).toBe('captureScene:custom%2Fmath%20test')
  })
})
