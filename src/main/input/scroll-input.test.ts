import { describe, expect, it } from 'vitest'

import {
  CONTINUOUS_SCROLL_DISTANCE_RATIO,
  DEFAULT_SCROLL_DISTANCE_RATIO
} from '@interview-coder/sync-protocol'

import { createScrollInputController } from './scroll-input'

describe('createScrollInputController', () => {
  it('uses a full page distance for the first press', () => {
    const controller = createScrollInputController({ now: () => 0 })

    expect(controller.next('down')).toBe(DEFAULT_SCROLL_DISTANCE_RATIO)
  })

  it('uses small repeated steps while the same direction is held', () => {
    let now = 0
    const controller = createScrollInputController({ now: () => now })

    expect(controller.next('down')).toBe(DEFAULT_SCROLL_DISTANCE_RATIO)
    now = 500
    expect(controller.next('down')).toBe(CONTINUOUS_SCROLL_DISTANCE_RATIO)
    now = 550
    expect(controller.next('down')).toBe(CONTINUOUS_SCROLL_DISTANCE_RATIO)
  })

  it('starts a new full page when direction changes or repeat times out', () => {
    let now = 0
    const controller = createScrollInputController({
      now: () => now,
      repeatWindowMs: 700
    })

    expect(controller.next('down')).toBe(DEFAULT_SCROLL_DISTANCE_RATIO)
    now = 500
    expect(controller.next('up')).toBe(DEFAULT_SCROLL_DISTANCE_RATIO)
    now = 1_201
    expect(controller.next('up')).toBe(DEFAULT_SCROLL_DISTANCE_RATIO)
  })

  it('resets immediately when requested', () => {
    let now = 0
    const controller = createScrollInputController({ now: () => now })

    expect(controller.next('down')).toBe(DEFAULT_SCROLL_DISTANCE_RATIO)
    now = 500
    expect(controller.next('down')).toBe(CONTINUOUS_SCROLL_DISTANCE_RATIO)
    controller.reset()
    now = 550
    expect(controller.next('down')).toBe(DEFAULT_SCROLL_DISTANCE_RATIO)
  })
})
