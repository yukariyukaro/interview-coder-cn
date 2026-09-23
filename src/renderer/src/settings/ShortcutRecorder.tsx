import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { PrefixToken } from '@interview-coder/shortcut-tokens'
import { Button } from '@/components/ui/button'
import ShortcutRenderer from '@/components/ShortcutRenderer'
import { getPrefixTokenForCode, getShortcutAccelerator, isModifierKey } from '@/lib/utils/keyboard'

type ShortcutRecorderProps = {
  value: string
  onChange: (value: string) => void
}

export function ShortcutRecorder({ value, onChange }: ShortcutRecorderProps) {
  const [recording, setRecording] = useState(false)
  const [recordingPrefix, setRecordingPrefix] = useState<PrefixToken | null>(null)

  useEffect(() => {
    if (!recording) return

    const stopRecording = () => {
      setRecording(false)
      setRecordingPrefix(null)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (event.code === 'Escape') {
        // Escape cancels, unless it is part of a modifier combo being recorded
        const composing = event.ctrlKey || event.altKey || event.shiftKey || event.metaKey
        if (recordingPrefix || !composing) {
          stopRecording()
          return
        }
      }

      // A right-side modifier becomes the sacrificial prefix; keep recording for the key
      const prefix = getPrefixTokenForCode(event.code)
      if (prefix) {
        setRecordingPrefix(prefix)
        return
      }

      if (isModifierKey(event.code)) return
      const accelerator = getShortcutAccelerator(event, { recordingPrefix })
      if (!accelerator) return
      onChange(accelerator)
      stopRecording()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onChange, recording, recordingPrefix])

  // The hook swallows the sacrificial right-side modifiers system-wide — this window
  // included — so it has to stand down while we listen for one.
  useEffect(() => {
    if (!recording) return
    void window.api.setHookSuspended(true)
    return () => {
      void window.api.setHookSuspended(false)
    }
  }, [recording])

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setRecordingPrefix(null)
          setRecording((value) => !value)
        }}
      >
        {recording ? (
          recordingPrefix ? (
            '已按下右侧修饰键，请再按一个主键...'
          ) : (
            '请按下快捷键...'
          )
        ) : value ? (
          <ShortcutRenderer shortcut={value} />
        ) : (
          '设置快捷键'
        )}
      </Button>
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="清除场景快捷键"
          onClick={() => onChange('')}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}
