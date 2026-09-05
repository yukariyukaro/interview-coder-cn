import { DEFAULT_SCROLL_DISTANCE_RATIO, type ScrollDirection } from '@interview-coder/sync-protocol'

type ScrollTargetInput = {
  direction: ScrollDirection
  currentOffset: number
  viewportHeight: number
  contentHeight: number
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

export function getNextScrollTop({
  direction,
  currentOffset,
  viewportHeight,
  contentHeight,
  distanceRatio = DEFAULT_SCROLL_DISTANCE_RATIO
}: ScrollTargetInput): number {
  const maxOffset = Math.max(0, contentHeight - viewportHeight)
  const boundedCurrentOffset = Math.min(maxOffset, Math.max(0, currentOffset))
  if (maxOffset === 0 || viewportHeight <= 0) return boundedCurrentOffset

  const pageDistance = viewportHeight * distanceRatio
  const nextOffset =
    direction === 'down' ? boundedCurrentOffset + pageDistance : boundedCurrentOffset - pageDistance
  return Math.min(maxOffset, Math.max(0, nextOffset))
}
