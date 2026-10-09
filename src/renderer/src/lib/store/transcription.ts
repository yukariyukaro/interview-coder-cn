import { create } from 'zustand'
import type { AudioSource } from '@/lib/audio-capture'

type SourceState = {
  /** This track is open and feeding the transcriber */
  active: boolean
  text: string
}

interface TranscriptionStore {
  sources: Record<AudioSource, SourceState>
  setSourceActive: (source: AudioSource, active: boolean) => void
  setSourceText: (source: AudioSource, text: string) => void
  clearSourceText: (source: AudioSource) => void
}

export const useTranscriptionStore = create<TranscriptionStore>()((set) => ({
  sources: {
    system: { active: false, text: '' },
    mic: { active: false, text: '' }
  },
  setSourceActive: (source, active) =>
    set((state) => ({
      sources: { ...state.sources, [source]: { ...state.sources[source], active } }
    })),
  setSourceText: (source, text) =>
    set((state) => ({
      sources: { ...state.sources, [source]: { ...state.sources[source], text } }
    })),
  clearSourceText: (source) =>
    set((state) => ({
      sources: { ...state.sources, [source]: { ...state.sources[source], text: '' } }
    }))
}))
