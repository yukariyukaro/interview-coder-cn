import { describe, expect, it } from 'vitest'

import {
  CONTINUOUS_SCROLL_DISTANCE_RATIO,
  DEFAULT_SCROLL_DISTANCE_RATIO
} from '@interview-coder/sync-protocol'

import { getNextScrollOffset, getNextScrollTop, getScrollBehavior } from './scroll'

describe('getNextScrollTop', () => {
  const baseInput = {
    currentOffset: 200,
    viewportHeight: 600,
    contentHeight: 2_000
  }

  it('moves by 75% of the viewport by default', () => {
    expect(getNextScrollTop({ ...baseInput, direction: 'down' })).toBe(
      200 + 600 * DEFAULT_SCROLL_DISTANCE_RATIO
    )
  })

  it('moves by an explicit continuous-scroll ratio', () => {
    expect(
      getNextScrollTop({
        ...baseInput,
        direction: 'down',
        distanceRatio: CONTINUOUS_SCROLL_DISTANCE_RATIO
      })
    ).toBe(260)
  })

  it('clamps both directions to the content boundaries', () => {
    expect(
      getNextScrollTop({
        ...baseInput,
        direction: 'up',
        currentOffset: 100
      })
    ).toBe(0)
    expect(
      getNextScrollTop({
        ...baseInput,
        direction: 'down',
        currentOffset: 1_300
      })
    ).toBe(1_400)
  })

  it('clamps a stale offset when content shrinks', () => {
    expect(
      getNextScrollTop({
        ...baseInput,
        direction: 'down',
        currentOffset: 1_900,
        contentHeight: 1_000
      })
    ).toBe(400)
  })

  it('does not scroll when content does not fill the viewport', () => {
    expect(
      getNextScrollTop({
        ...baseInput,
        direction: 'down',
        contentHeight: 500
      })
    ).toBe(0)
  })

  it('uses immediate scrolling while content is streaming', () => {
    expect(getScrollBehavior({ isStreaming: true })).toBe('auto')
    expect(getScrollBehavior({ isStreaming: false })).toBe('smooth')
    expect(getScrollBehavior({ isStreaming: false, distanceRatio: 0.1 })).toBe('auto')
  })
})

describe('getNextScrollOffset', () => {
  const baseInput = {
    currentOffset: 200,
    viewportSize: 600,
    contentSize: 2_000
  }

  it('moves horizontally by 75% of the viewport by default', () => {
    expect(getNextScrollOffset({ ...baseInput, direction: 'right' })).toBe(
      200 + 600 * DEFAULT_SCROLL_DISTANCE_RATIO
    )
  })

  it('moves horizontally by the continuous-scroll ratio', () => {
    expect(
      getNextScrollOffset({
        ...baseInput,
        direction: 'left',
        distanceRatio: CONTINUOUS_SCROLL_DISTANCE_RATIO
      })
    ).toBe(140)
  })

  it('clamps horizontal offsets to both content boundaries', () => {
    expect(
      getNextScrollOffset({
        ...baseInput,
        direction: 'left',
        currentOffset: 100
      })
    ).toBe(0)
    expect(
      getNextScrollOffset({
        ...baseInput,
        direction: 'right',
        currentOffset: 1_300
      })
    ).toBe(1_400)
  })

  it('does not scroll when horizontal content does not fill the viewport', () => {
    expect(
      getNextScrollOffset({
        ...baseInput,
        direction: 'right',
        contentSize: 500
      })
    ).toBe(0)
  })

  it('clamps a stale horizontal offset when content shrinks', () => {
    expect(
      getNextScrollOffset({
        ...baseInput,
        direction: 'right',
        currentOffset: 1_900,
        contentSize: 1_000
      })
    ).toBe(400)
  })
})
