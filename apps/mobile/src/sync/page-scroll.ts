import { DEFAULT_SCROLL_DISTANCE_RATIO, type ScrollDirection } from '@interview-coder/sync-protocol'

type PageScrollInput = {
  direction: ScrollDirection
  currentOffset: number
  viewportHeight: number
  contentHeight: number
  distanceRatio?: number
}

export function getNextPageOffset({
  direction,
  currentOffset,
  viewportHeight,
  contentHeight,
  distanceRatio = DEFAULT_SCROLL_DISTANCE_RATIO
}: PageScrollInput): number {
  const maxOffset = Math.max(0, contentHeight - viewportHeight)
  if (maxOffset === 0) return 0

  const pageDistance = Math.max(0, viewportHeight * distanceRatio)
  const nextOffset =
    direction === 'down' ? currentOffset + pageDistance : currentOffset - pageDistance
  return Math.min(maxOffset, Math.max(0, nextOffset))
}
