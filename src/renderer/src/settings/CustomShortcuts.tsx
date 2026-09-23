import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { toast } from 'sonner'
import {
  getEffectiveAccelerator,
  hasModifierToken,
  resolveShortcutChannel,
  type PrefixToken,
  type ShortcutChannel
} from '@interview-coder/shortcut-tokens'
import { Button } from '@/components/ui/button'
import ShortcutRenderer from '@/components/ShortcutRenderer'
import { getPrefixTokenForCode, getShortcutAccelerator, isModifierKey } from '@/lib/utils/keyboard'
import { isShortcutCustomized, useShortcutsStore } from '@/lib/store/shortcuts'
import { useSettingsStore } from '@/lib/store/settings'
import { useHookStatusStore } from '@/lib/store/hook'
import { platform } from '@/lib/utils/env'

const ShortcutsContext = createContext<{
  recordingAction: string | null
  recordingPrefix: PrefixToken | null
  setRecordingAction: (action: string | null) => void
}>({
  recordingAction: null,
  recordingPrefix: null,
  setRecordingAction: () => {}
})

export function CustomShortcuts() {
  const { shortcuts, updateShortcut } = useShortcutsStore()
  const { dashscopeApiKey } = useSettingsStore()
  const [recordingAction, setRecordingAction] = useState<string | null>(null)
  const [recordingPrefix, setRecordingPrefix] = useState<PrefixToken | null>(null)

  const stopRecording = useCallback(() => {
    setRecordingAction(null)
    setRecordingPrefix(null)
  }, [])

  const onShortcutChange = useCallback(
    (action: string, key: string) => {
      const newShortcut = { ...shortcuts[action], key }
      updateShortcut(action, newShortcut)
      window.api.updateShortcuts([newShortcut])
    },
    [shortcuts, updateShortcut]
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!recordingAction) return

      e.preventDefault()
      e.stopPropagation()

      if (e.code === 'Escape') {
        // Escape cancels, unless it is part of a modifier combo being recorded
        const composing = e.ctrlKey || e.altKey || e.shiftKey || e.metaKey
        if (recordingPrefix || !composing) {
          stopRecording()
          return
        }
      }

      // A right-side modifier becomes the sacrificial prefix; keep recording for the key
      const prefix = getPrefixTokenForCode(e.code)
      if (prefix) {
        setRecordingPrefix(prefix)
        return
      }

      if (isModifierKey(e.code)) return
      const accelerator = getShortcutAccelerator(e, { recordingPrefix })
      if (!accelerator) return
      onShortcutChange(recordingAction, accelerator)
      stopRecording()
    },
    [recordingAction, recordingPrefix, onShortcutChange, stopRecording]
  )

  useEffect(() => {
    if (!recordingAction) return
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [recordingAction, handleKeyDown])

  // The hook swallows the sacrificial right-side modifiers system-wide — this window
  // included — so it has to stand down while we listen for one.
  useEffect(() => {
    if (!recordingAction) return
    void window.api.setHookSuspended(true)
    return () => {
      void window.api.setHookSuspended(false)
    }
  }, [recordingAction])

  return (
    <ShortcutsContext.Provider value={{ recordingAction, recordingPrefix, setRecordingAction }}>
      <div className="space-y-4">
        {/* Window Management */}
        <div className="space-y-2">
          <h3 className="text-sm text-gray-500">窗口管理</h3>
          <Shortcut
            label="静默后台运行"
            description="进入或退出持久静默状态；隐藏/显示窗口快捷键也可退出静默"
            shortcut="toggleSilentMode"
          />
          <Shortcut label="隐藏/显示窗口" shortcut="hideOrShowMainWindow" />
          <Shortcut
            label="鼠标穿透"
            description="启用后窗口对鼠标穿透，可以点击窗口背后的内容"
            shortcut="ignoreOrEnableMouse"
          />
          <Shortcut
            label="提高不透明度"
            description="每次调整 5%，窗口更清晰"
            shortcut="increaseOpacity"
          />
          <Shortcut
            label="提高透明度"
            description="每次调整 5%，窗口更透明"
            shortcut="decreaseOpacity"
          />
          <Shortcut
            label="切换日间/夜间模式"
            description="在日间与夜间显示模式之间切换"
            shortcut="toggleColorMode"
          />
        </div>

        {/* Screenshot & AI */}
        <div className="space-y-2">
          <h3 className="text-sm text-gray-500">截图与AI</h3>
          <Shortcut
            label="追加截图"
            description="在当前对话中追加截图并生成解题建议，适用于长题目等场景"
            shortcut="appendScreenshot"
          />
          <Shortcut
            label="停止生成"
            description="打断当前正在生成的解题建议"
            shortcut="stopSolutionStream"
          />
          <Shortcut
            label="语音转录"
            description="开始/暂停实时语音转录"
            shortcut="toggleTranscription"
            disabled={!dashscopeApiKey}
          />
          <Shortcut
            label="清除转录文本"
            description="清除已转录的文本（不会提交给AI）"
            shortcut="clearTranscription"
            disabled={!dashscopeApiKey}
          />
        </div>

        {/* Navigation */}
        <div className="space-y-2">
          <h3 className="text-sm text-gray-500">页面导航</h3>
          <Shortcut label="电脑与手机同步向上翻页" shortcut="pageUp" />
          <Shortcut label="电脑与手机同步向下翻页" shortcut="pageDown" />
          <Shortcut label="电脑端向左翻页" shortcut="pageLeft" />
          <Shortcut label="电脑端向右翻页" shortcut="pageRight" />
        </div>

        {/* Window Movement */}
        <div className="space-y-2">
          <h3 className="text-sm text-gray-500">窗口移动</h3>
          <Shortcut label="向上移动窗口" shortcut="moveMainWindowUp" />
          <Shortcut label="向下移动窗口" shortcut="moveMainWindowDown" />
          <Shortcut label="向左移动窗口" shortcut="moveMainWindowLeft" />
          <Shortcut label="向右移动窗口" shortcut="moveMainWindowRight" />
        </div>
      </div>
    </ShortcutsContext.Provider>
  )
}

/** Explains which channel the binding currently runs through */
function ChannelBadge({ channel, accelerator }: { channel: ShortcutChannel; accelerator: string }) {
  if (channel === 'hook') {
    return <Badge className="bg-emerald-100 text-emerald-700">无痕</Badge>
  }
  if (channel === 'unsupported') {
    return <Badge className="bg-red-100 text-red-700">不可用，请改键</Badge>
  }
  return hasModifierToken(accelerator) ? (
    <Badge className="bg-amber-100 text-amber-700">会泄漏修饰键</Badge>
  ) : null
}

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs whitespace-nowrap ${className ?? ''}`}>
      {children}
    </span>
  )
}

function Shortcut({
  label,
  description,
  shortcut: shortcutAction,
  disabled
}: {
  label: string
  description?: string
  shortcut: string
  disabled?: boolean
}) {
  const { shortcuts } = useShortcutsStore()
  const { recordingAction, recordingPrefix, setRecordingAction } = useContext(ShortcutsContext)
  const hookAvailable = useHookStatusStore((state) => state.available)
  const shortcut = shortcuts[shortcutAction]
  const isRecording = recordingAction === shortcutAction
  const channel = shortcut
    ? resolveShortcutChannel(shortcut.key, hookAvailable, platform)
    : ('system' as ShortcutChannel)
  const accelerator = shortcut ? getEffectiveAccelerator(shortcut.key, channel, platform) : ''

  return shortcut ? (
    <div
      className={`flex items-center justify-between${disabled ? ' opacity-40 pointer-events-none' : ''}`}
    >
      <div className="flex gap-2 items-center">
        <label className="text-sm font-medium">{label}</label>
        {description && <p className="text-xs font-light">{description}</p>}
      </div>
      <div className="flex items-center gap-2">
        {!isRecording && <ChannelBadge channel={channel} accelerator={accelerator} />}
        <span
          className="cursor-pointer"
          onClick={() => setRecordingAction(isRecording ? null : shortcutAction)}
        >
          {!isRecording ? (
            <ShortcutRenderer shortcut={accelerator} />
          ) : (
            <span className="font-mono text-sm align-middle rounded-md pl-2 pr-1 py-1 transition-colors bg-gray-200 animate-pulse">
              {recordingPrefix ? '已按下右侧修饰键，请再按一个主键...' : '请按下自定义快捷键...'}
            </span>
          )}
        </span>
      </div>
    </div>
  ) : null
}

export function ResetDefaultShortcuts() {
  const { shortcuts, resetShortcuts } = useShortcutsStore()
  return (
    <Button
      variant="outline"
      size="sm"
      className="ml-auto"
      onClick={async () => {
        await window.api.updateShortcuts(
          Object.values(shortcuts)
            .filter(isShortcutCustomized)
            .map((shortcut) => ({ ...shortcut, key: shortcut.defaultKey }))
        )
        resetShortcuts()
        toast.success('重置默认快捷键成功')
      }}
    >
      重置默认快捷键
    </Button>
  )
}
