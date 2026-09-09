import { DEFAULT_SCROLL_DISTANCE_RATIO } from '@interview-coder/sync-protocol'

export type ScrollDirection = 'up' | 'down' | 'left' | 'right'

type VerticalScrollDirection = Extract<ScrollDirection, 'up' | 'down'>

type ScrollTargetInput = {
  direction: ScrollDirection
  currentOffset: number
  viewportSize: number
  contentSize: number
  distanceRatio?: number
}

type ScrollBehaviorInput = {
  isStreaming: boolean
  distanceRatio?: number
}

export function getScrollBehavior({
  isStreaming,
  distanceRatio
}: ScrollBehaviorInput): ScrollBehavior {
  if (isStreaming) return 'auto'
  return distanceRatio !== undefined && distanceRatio < DEFAULT_SCROLL_DISTANCE_RATIO
    ? 'auto'
    : 'smooth'
}

export function getNextScrollOffset({
  direction,
  currentOffset,
  viewportSize,
  contentSize,
  distanceRatio = DEFAULT_SCROLL_DISTANCE_RATIO
}: ScrollTargetInput): number {
  const maxOffset = Math.max(0, contentSize - viewportSize)
  const boundedCurrentOffset = Math.min(maxOffset, Math.max(0, currentOffset))
  if (maxOffset === 0 || viewportSize <= 0) return boundedCurrentOffset

  const pageDistance = viewportSize * distanceRatio
  const nextOffset =
    direction === 'down' || direction === 'right'
      ? boundedCurrentOffset + pageDistance
      : boundedCurrentOffset - pageDistance
  return Math.min(maxOffset, Math.max(0, nextOffset))
}

export function getNextScrollTop(input: {
  direction: VerticalScrollDirection
  currentOffset: number
  viewportHeight: number
  contentHeight: number
  distanceRatio?: number
}): number {
  return getNextScrollOffset({
    direction: input.direction,
    currentOffset: input.currentOffset,
    viewportSize: input.viewportHeight,
    contentSize: input.contentHeight,
    distanceRatio: input.distanceRatio
  })
}
