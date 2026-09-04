import type { ScrollDirection } from '@interview-coder/sync-protocol'

export const PAGE_SCROLL_VIEWPORT_RATIO = 0.85

type PageScrollInput = {
  direction: ScrollDirection
  currentOffset: number
  viewportHeight: number
  contentHeight: number
}

export function getNextPageOffset({
  direction,
  currentOffset,
  viewportHeight,
  contentHeight
}: PageScrollInput): number {
  const maxOffset = Math.max(0, contentHeight - viewportHeight)
  if (maxOffset === 0) return 0

  const pageDistance = Math.max(0, viewportHeight * PAGE_SCROLL_VIEWPORT_RATIO)
  const nextOffset =
    direction === 'down' ? currentOffset + pageDistance : currentOffset - pageDistance
  return Math.min(maxOffset, Math.max(0, nextOffset))
}
