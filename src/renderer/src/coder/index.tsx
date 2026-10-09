import { useEffect } from 'react'
import { toast } from 'sonner'
import { useSettingsStore } from '@/lib/store/settings'
import { useAppStore } from '@/lib/store/app'
import { useTranscriptionStore } from '@/lib/store/transcription'
import { useSolutionStore } from '@/lib/store/solution'
import {
  AUDIO_SOURCES,
  hasAudioCapture,
  startAudioCapture,
  stopAudioCapture,
  type AudioSource
} from '@/lib/audio-capture'

import { AppHeader } from './AppHeader'
import { AppContent } from './AppContent'
import { AppStatusBar } from './AppStatusBar'
import { PrerequisitesChecker } from './PrerequisitesChecker'
import { TranscriptionBar } from './TranscriptionBar'

export default function CoderPage() {
  const { opacity, dashscopeApiKey } = useSettingsStore()
  const { syncAppState } = useAppStore()
  const { sources, setSourceActive, setSourceText, clearSourceText } = useTranscriptionStore()
  const { setErrorMessage } = useSolutionStore()

  useEffect(() => {
    document.body.style.opacity = opacity.toString()
    return () => {
      document.body.style.opacity = ''
    }
  }, [opacity])

  useEffect(() => {
    window.api.onAdjustOpacity((delta) => {
      useSettingsStore.getState().adjustOpacity(delta)
    })
    return () => {
      window.api.removeAdjustOpacityListener()
    }
  }, [])

  useEffect(() => {
    window.api.updateAppState({ inCoderPage: true })
    return () => {
      window.api.updateAppState({ inCoderPage: false })
    }
  }, [])

  useEffect(() => {
    window.api.onSyncAppState((state) => {
      syncAppState(state)
    })
    return () => {
      window.api.removeSyncAppStateListener()
    }
  }, [syncAppState])

  useEffect(() => {
    const stopSource = async (source: AudioSource) => {
      stopAudioCapture(source)
      setSourceActive(source, false)
      await window.api.stopTranscription(source)
    }

    const startSource = async (source: AudioSource) => {
      if (!dashscopeApiKey) {
        setErrorMessage('请先在设置中配置百炼平台 API Key')
        return
      }
      try {
        await startAudioCapture(source)
        await window.api.startTranscription(dashscopeApiKey, source)
        setSourceActive(source, true)
        setErrorMessage(null)
      } catch (err) {
        console.error(`Failed to start ${source} transcription:`, err)
        await stopSource(source)
        setErrorMessage(
          source === 'system'
            ? '启动系统音频转录失败，请确认已允许屏幕/声音录制'
            : '启动麦克风转录失败，请检查麦克风权限'
        )
      }
    }

    window.api.onToggleTranscription(async (source) => {
      if (sources[source].active) {
        await stopSource(source)
      } else {
        await startSource(source)
      }
    })
    return () => {
      window.api.removeToggleTranscriptionListener()
    }
  }, [sources, dashscopeApiKey, setSourceActive, setErrorMessage])

  useEffect(() => {
    window.api.onTranscriptionText((source, data) => {
      setSourceText(source, data.text)
    })
    window.api.onTranscriptionError((source, message) => {
      setErrorMessage(message)
      setSourceActive(source, false)
      stopAudioCapture(source)
    })
    window.api.onTranscriptionStopped((source) => {
      setSourceActive(source, false)
      stopAudioCapture(source)
    })
    window.api.onTranscriptionCleared((source) => {
      clearSourceText(source)
    })
    window.api.onTranscriptionEmpty(() => {
      toast('没有待发送的语音转录')
    })

    return () => {
      window.api.removeTranscriptionTextListener()
      window.api.removeTranscriptionErrorListener()
      window.api.removeTranscriptionStoppedListener()
      window.api.removeTranscriptionClearedListener()
      window.api.removeTranscriptionEmptyListener()
    }
  }, [setSourceText, setErrorMessage, setSourceActive, clearSourceText])

  // Transcription outlives this page: opening the settings or help page must not
  // end the interview's capture, so nothing is torn down on unmount. On the way
  // back both tracks are re-aligned with the main process instead of being assumed
  // (one can die, or keep talking, while we are away).
  useEffect(() => {
    void Promise.all(
      AUDIO_SOURCES.map(async (source) => {
        const [active, text] = await Promise.all([
          window.api.getTranscriptionStatus(source),
          window.api.getTranscriptionText(source)
        ])
        return { source, active, text }
      })
    ).then((tracks) => {
      for (const { source, active, text } of tracks) {
        setSourceText(source, text)
        if (active && hasAudioCapture(source)) {
          setSourceActive(source, true)
        } else {
          setSourceActive(source, false)
          // Main is still listening but this renderer can no longer feed it (reloaded
          // page): it would burn ASR time for nothing, so stand it down
          if (active) void window.api.stopTranscription(source)
        }
      }
    })
  }, [setSourceActive, setSourceText])

  return (
    <div className="relative h-screen">
      <AppHeader />
      <AppContent />
      <TranscriptionBar />
      <AppStatusBar />
      <PrerequisitesChecker />
    </div>
  )
}
