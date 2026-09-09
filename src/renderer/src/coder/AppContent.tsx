import { useEffect, useRef, useState } from 'react'
import { Images } from 'lucide-react'
import { useSettingsStore, type ScreenshotDisplay } from '@/lib/store/settings'
import { useSolutionStore } from '@/lib/store/solution'
import { getNextScrollOffset, getScrollBehavior } from '@/lib/scroll'
import MarkdownRenderer from '@/components/MarkdownRenderer'
import ShortcutRenderer from '@/components/ShortcutRenderer'

const CONTINUOUS_SCROLL_TARGET_HOLD_MS = 350
type ScrollAxis = 'vertical' | 'horizontal'

export function AppContent() {
  const {
    isLoading,
    screenshotData,
    solutionChunks,
    errorMessage,
    setScreenshotData,
    setIsLoading,
    addSolutionChunk,
    setErrorMessage,
    clearSolution
  } = useSolutionStore()

  const screenshotDisplay = useSettingsStore((state) => state.screenshotDisplay)

  const [recentScreenshots, setRecentScreenshots] = useState<string[]>([])
  const isStreamingRef = useRef(isLoading)
  const scrollTargetsRef = useRef<{ vertical: number | null; horizontal: number | null }>({
    vertical: null,
    horizontal: null
  })
  const scrollTargetTimersRef = useRef<{
    vertical: ReturnType<typeof setTimeout> | null
    horizontal: ReturnType<typeof setTimeout> | null
  }>({
    vertical: null,
    horizontal: null
  })
  // Main keeps only the last 5 thumbnails, but every screenshot went to the AI
  const [screenshotTotal, setScreenshotTotal] = useState(0)
  isStreamingRef.current = isLoading

  useEffect(() => {
    // Listen for screenshot events (latest)
    window.api.onScreenshotTaken((data: string) => {
      setScreenshotData(data)
    })

    // Listen for screenshots-updated events (gallery)
    window.api.onScreenshotsUpdated((screenshots: string[], total: number) => {
      setRecentScreenshots(screenshots)
      setScreenshotTotal(total)
    })

    // New session clear (pictures + answers)
    window.api.onSolutionClear(() => {
      clearSolution()
      setRecentScreenshots([])
      setScreenshotTotal(0)
      setScreenshotData(null)
      setErrorMessage(null)
    })

    // Listen for solution chunks
    window.api.onSolutionChunk((chunk: string) => {
      addSolutionChunk(chunk)
    })

    // AI loading
    window.api.onAiLoadingStart(() => {
      setIsLoading(true)
      setErrorMessage(null) // Clear error when new request starts
    })
    window.api.onAiLoadingEnd(() => {
      setIsLoading(false)
    })

    // Cleanup listeners on unmount
    return () => {
      window.api.removeScreenshotListener()
      window.api.removeScreenshotsUpdatedListener()
      window.api.removeSolutionChunkListener()
      window.api.removeAiLoadingStartListener()
      window.api.removeAiLoadingEndListener()
      window.api.removeSolutionClearListener()
    }
  }, [setScreenshotData, clearSolution, setIsLoading, addSolutionChunk, setErrorMessage])

  useEffect(() => {
    window.api.onSolutionComplete(() => {
      setIsLoading(false)
    })
    window.api.onSolutionStopped(() => {
      setIsLoading(false)
    })
    window.api.onSolutionError((message: string) => {
      setIsLoading(false)
      setErrorMessage(message)
    })
    return () => {
      window.api.removeSolutionCompleteListener()
      window.api.removeSolutionStoppedListener()
      window.api.removeSolutionErrorListener()
    }
  }, [setIsLoading, setErrorMessage])

  useEffect(() => {
    const container = document.getElementById('app-content')
    if (!container) return

    const clearProgrammaticTarget = (axis?: ScrollAxis) => {
      const axes: ScrollAxis[] = axis ? [axis] : ['vertical', 'horizontal']
      axes.forEach((currentAxis) => {
        scrollTargetsRef.current[currentAxis] = null
        const timer = scrollTargetTimersRef.current[currentAxis]
        if (timer !== null) {
          clearTimeout(timer)
          scrollTargetTimersRef.current[currentAxis] = null
        }
      })
    }

    const scheduleProgrammaticTargetReset = (axis: ScrollAxis) => {
      const timer = scrollTargetTimersRef.current[axis]
      if (timer !== null) clearTimeout(timer)
      scrollTargetTimersRef.current[axis] = setTimeout(() => {
        scrollTargetsRef.current[axis] = null
        scrollTargetTimersRef.current[axis] = null
      }, CONTINUOUS_SCROLL_TARGET_HOLD_MS)
    }

    const scrollPage = (direction: 'up' | 'down' | 'left' | 'right', distanceRatio?: number) => {
      const isHorizontal = direction === 'left' || direction === 'right'
      const axis: ScrollAxis = isHorizontal ? 'horizontal' : 'vertical'
      const currentOffset =
        scrollTargetsRef.current[axis] ??
        (isHorizontal ? container.scrollLeft : container.scrollTop)
      const target = getNextScrollOffset({
        direction,
        currentOffset,
        viewportSize: isHorizontal ? container.clientWidth : container.clientHeight,
        contentSize: isHorizontal ? container.scrollWidth : container.scrollHeight,
        distanceRatio
      })
      scrollTargetsRef.current[axis] = target
      container.scrollTo({
        ...(isHorizontal ? { left: target } : { top: target }),
        behavior: getScrollBehavior({
          isStreaming: isStreamingRef.current,
          distanceRatio
        })
      })
      scheduleProgrammaticTargetReset(axis)
    }

    const resetOnManualScroll = () => {
      clearProgrammaticTarget()
    }

    window.api.onScrollPageUp((distanceRatio) => {
      scrollPage('up', distanceRatio)
    })
    window.api.onScrollPageDown((distanceRatio) => {
      scrollPage('down', distanceRatio)
    })
    window.api.onScrollPageLeft((distanceRatio) => {
      scrollPage('left', distanceRatio)
    })
    window.api.onScrollPageRight((distanceRatio) => {
      scrollPage('right', distanceRatio)
    })
    container.addEventListener('wheel', resetOnManualScroll, { passive: true })
    container.addEventListener('pointerdown', resetOnManualScroll)
    container.addEventListener('touchstart', resetOnManualScroll, { passive: true })

    return () => {
      window.api.removeScrollPageUpListener()
      window.api.removeScrollPageDownListener()
      window.api.removeScrollPageLeftListener()
      window.api.removeScrollPageRightListener()
      container.removeEventListener('wheel', resetOnManualScroll)
      container.removeEventListener('pointerdown', resetOnManualScroll)
      container.removeEventListener('touchstart', resetOnManualScroll)
      clearProgrammaticTarget()
    }
  }, [])

  // `screenshots-updated` always accompanies `screenshot-taken`; the fallback only
  // covers a render that lands between the two
  const screenshots =
    recentScreenshots.length > 0 ? recentScreenshots : screenshotData ? [screenshotData] : []

  return (
    <div id="app-content" className="px-6 py-4">
      {/* Error Banner */}
      {errorMessage && (
        <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg flex items-start gap-3">
          <svg
            className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-red-400 font-medium text-sm">API 调用失败</p>
            <p className="text-red-300/80 text-sm mt-0.5 break-words">{errorMessage}</p>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-red-400/80 hover:text-red-300 flex-shrink-0"
            title="关闭"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Screenshots, rendered as the `screenshotDisplay` setting asks */}
      {screenshots.length === 0 ? (
        <ShortcutTip />
      ) : (
        <Screenshots
          screenshots={screenshots}
          total={Math.max(screenshotTotal, screenshots.length)}
          display={screenshotDisplay}
        />
      )}

      {/* Solution Display */}
      <MarkdownRenderer>{solutionChunks.join('')}</MarkdownRenderer>
    </div>
  )
}

function Screenshots({
  screenshots,
  total,
  display
}: {
  screenshots: string[]
  /** Every screenshot sent to the AI, which can exceed the thumbnails kept around */
  total: number
  display: ScreenshotDisplay
}) {
  if (display === 'none') return null

  if (display === 'count') {
    // The content area sits on bg-gray-500, so the card reads light-on-dark like the prose
    return (
      <div className="screenshot-count mb-4 inline-flex items-center gap-1.5 rounded-lg border border-white/30 bg-white/10 px-2.5 py-1 text-sm text-gray-100 select-none">
        <Images className="h-4 w-4" />
        {total} 张截图
      </div>
    )
  }

  return (
    <div className="mb-4 flex gap-2 overflow-x-auto pb-2">
      {screenshots.map((data, index) => (
        <img
          key={index}
          src={`data:image/png;base64,${data}`}
          alt={`Screenshot ${index + 1}`}
          className="w-40 h-auto flex-shrink-0 border border-gray-600 rounded-lg shadow-lg hover:shadow-xl transition-shadow"
          title={`第 ${index + 1} 张截图`}
        />
      ))}
    </div>
  )
}

function ShortcutTip() {
  const activeSceneShortcut = useSettingsStore(
    (state) => state.scenes.find((scene) => scene.id === state.activeSceneId)?.shortcut
  )
  if (!activeSceneShortcut) {
    return (
      <div className="flex items-center justify-center h-full text-xl text-gray-400 select-none">
        请在设置中配置场景截图快捷键
      </div>
    )
  }
  return (
    <div className="flex items-center justify-center h-full text-xl text-gray-400 select-none">
      请按下快捷键
      <ShortcutRenderer shortcut={activeSceneShortcut} className="mx-1 font-bold text-black" />
      抓取屏幕进行分析
    </div>
  )
}
