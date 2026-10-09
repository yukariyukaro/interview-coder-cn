import { useEffect, useRef } from 'react'
import { Mic } from 'lucide-react'
import { AUDIO_SOURCES, type AudioSource } from '@/lib/audio-capture'
import { useTranscriptionStore } from '@/lib/store/transcription'

/** Who each track's text belongs to, so the display matches the prompt's tags */
const SOURCE_LABELS: Record<AudioSource, string> = {
  system: '面试官（系统音频）',
  mic: '候选人（麦克风）'
}

export function TranscriptionBar() {
  const { sources } = useTranscriptionStore()
  // One line per track that is listening or has something to show
  const visible = AUDIO_SOURCES.filter((source) => sources[source].active || sources[source].text)
  if (visible.length === 0) return null

  return (
    <div className="absolute top-10 left-0 right-0 px-6 pb-2 z-10 space-y-1">
      {visible.map((source) => (
        <SourceLine
          key={source}
          source={source}
          active={sources[source].active}
          text={sources[source].text}
        />
      ))}
    </div>
  )
}

function SourceLine({
  source,
  active,
  text
}: {
  source: AudioSource
  active: boolean
  text: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [text])

  return (
    <div className="transcription-panel flex items-start gap-2 bg-gray-700/80 rounded-lg pl-2 pr-0 py-1">
      <span className="flex items-center gap-1 text-xs text-gray-400 mt-0.5 flex-shrink-0 whitespace-nowrap">
        {active && <Mic className="w-4 h-4 text-green-400 animate-pulse" />}
        {SOURCE_LABELS[source]}
      </span>
      <div
        ref={scrollRef}
        className="transcription-scroll text-sm text-gray-300 max-h-[4.2em] overflow-y-auto leading-[1.4em] flex-1 whitespace-pre-wrap break-words"
      >
        {text || (active ? '等待语音输入...' : '')}
      </div>
    </div>
  )
}
