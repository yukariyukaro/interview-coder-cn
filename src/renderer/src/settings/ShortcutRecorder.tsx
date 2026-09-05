import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import ShortcutRenderer from '@/components/ShortcutRenderer'
import { getShortcutAccelerator, isModifierKey } from '@/lib/utils/keyboard'

type ShortcutRecorderProps = {
  value: string
  onChange: (value: string) => void
}

export function ShortcutRecorder({ value, onChange }: ShortcutRecorderProps) {
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (!recording) return

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      if (isModifierKey(event.code)) return
      if (event.code === 'Escape') {
        setRecording(false)
        return
      }

      const accelerator = getShortcutAccelerator(event)
      if (!accelerator) return
      onChange(accelerator)
      setRecording(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onChange, recording])

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" onClick={() => setRecording((value) => !value)}>
        {recording ? (
          '请按下快捷键...'
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
