import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import codingPrompt from './prompts/coding.md?raw'
import englishExamPrompt from './prompts/english-exam.md?raw'
import aptitudeTestPrompt from './prompts/aptitude-test.md?raw'
import generalQaPrompt from './prompts/general-qa.md?raw'
import { platformAlt } from '../utils/env'

export type ReasoningEffort = 'default' | 'minimal' | 'low' | 'medium' | 'high'
export type ColorMode = 'light' | 'dark'

const reasoningEfforts: ReasoningEffort[] = ['default', 'minimal', 'low', 'medium', 'high']

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return reasoningEfforts.includes(value as ReasoningEffort)
}

export interface PromptScene {
  id: string
  name: string
  prompt: string
  apiBaseURL: string
  apiKey: string
  model: string
  reasoningEffort: ReasoningEffort
  shortcut: string
  isPreset: boolean
}

export const CODING_SCENE_ID = 'coding'

/** Default prompts for all preset scenes, maintained as Markdown files under ./prompts */
export const PRESET_SCENE_PROMPTS: Record<string, string> = {
  [CODING_SCENE_ID]: codingPrompt,
  'english-exam': englishExamPrompt,
  'aptitude-test': aptitudeTestPrompt,
  'general-qa': generalQaPrompt
}

const createPresetScenes = (): PromptScene[] => [
  {
    id: CODING_SCENE_ID,
    name: '解算法题',
    prompt: PRESET_SCENE_PROMPTS[CODING_SCENE_ID],
    apiBaseURL: '',
    apiKey: '',
    model: '',
    reasoningEffort: 'default',
    shortcut: `${platformAlt}+Enter`,
    isPreset: true
  },
  {
    id: 'english-exam',
    name: '英语考试',
    prompt: PRESET_SCENE_PROMPTS['english-exam'],
    apiBaseURL: '',
    apiKey: '',
    model: '',
    reasoningEffort: 'low',
    shortcut: `${platformAlt}+E`,
    isPreset: true
  },
  {
    id: 'aptitude-test',
    name: '能力测评',
    prompt: PRESET_SCENE_PROMPTS['aptitude-test'],
    apiBaseURL: '',
    apiKey: '',
    model: '',
    reasoningEffort: 'low',
    shortcut: `${platformAlt}+P`,
    isPreset: true
  },
  {
    id: 'general-qa',
    name: '通用问答',
    prompt: PRESET_SCENE_PROMPTS['general-qa'],
    apiBaseURL: '',
    apiKey: '',
    model: '',
    reasoningEffort: 'default',
    shortcut: `${platformAlt}+G`,
    isPreset: true
  }
]

/** Derive the `customPrompt` (the system prompt used by the main process) from the active scene */
function composeCustomPrompt(scenes: PromptScene[], activeSceneId: string): string {
  const scene = scenes.find((s) => s.id === activeSceneId)
  if (!scene) return PRESET_SCENE_PROMPTS[CODING_SCENE_ID]
  // An emptied preset scene falls back to its default prompt
  return scene.prompt.trim() || PRESET_SCENE_PROMPTS[scene.id] || ''
}

/** How captured screenshots are shown on the main page, ordered by how much room they take */
export type ScreenshotDisplay = 'none' | 'count' | 'gallery'

export const OPACITY_MIN = 0.1
export const OPACITY_MAX = 1
export const OPACITY_STEP = 0.05

interface Settings {
  // theme: 'light' | 'dark'an
  apiBaseURL: string
  apiKey: string
  model: string
  customModels: string[]
  customPrompt: string

  scenes: PromptScene[]
  activeSceneId: string

  opacity: number
  /** Allow resizing the main window and overlay toolbar */
  resizable: boolean
  /** Show the click-through overlay toolbar above the main window */
  showOverlayToolbar: boolean
  /** Dwell time in ms before hovering a toolbar button fires it; 0 disables hover triggering */
  toolbarHoverDelay: number
  /** How the captured screenshots are shown above the solution */
  screenshotDisplay: ScreenshotDisplay
  colorMode: ColorMode

  screenshotAutoSave: boolean
  answerAutoSave: boolean
  screenshotDir: string

  dashscopeApiKey: string

  hideDockIcon: boolean
  /** Keep the main window and overlay toolbar hidden while background shortcuts remain active */
  silentMode: boolean
  syncEnabled: boolean
  syncServerUrl: string
  syncPairingCode: string

  audioInputDeviceId: string
  audioOutputDeviceId: string
}

interface SettingsStore extends Settings {
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  /** Step the window opacity within [OPACITY_MIN, OPACITY_MAX] */
  adjustOpacity: (delta: number) => void
  syncSettings: (settings: Partial<Settings>) => void
  setActiveScene: (id: string) => void
  updateScene: (
    id: string,
    update: Partial<
      Pick<
        PromptScene,
        'apiBaseURL' | 'apiKey' | 'model' | 'prompt' | 'reasoningEffort' | 'shortcut'
      >
    >
  ) => void
  updateScenePrompt: (id: string, prompt: string) => void
  addScene: (name: string) => string
  removeScene: (id: string) => void
}

const defaultSettings: Settings = {
  apiBaseURL: '',
  apiKey: '',
  model: '',
  customModels: [],
  customPrompt: PRESET_SCENE_PROMPTS[CODING_SCENE_ID],
  scenes: createPresetScenes(),
  activeSceneId: CODING_SCENE_ID,

  opacity: 0.8,
  resizable: true,
  showOverlayToolbar: true,
  toolbarHoverDelay: 1000,
  screenshotDisplay: 'gallery',
  colorMode: 'dark',

  screenshotAutoSave: false,
  answerAutoSave: false,
  screenshotDir: '',

  dashscopeApiKey: '',

  hideDockIcon: false,
  silentMode: false,
  syncEnabled: false,
  syncServerUrl: '',
  syncPairingCode: '',

  audioInputDeviceId: '',
  audioOutputDeviceId: ''
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      ...defaultSettings,
      updateSetting: (key, value) => {
        set({ [key]: value })
      },
      adjustOpacity: (delta) => {
        const raw = get().opacity + delta
        // Round to 2 decimals to avoid float drift across repeated presses
        const opacity = Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, Math.round(raw * 100) / 100))
        set({ opacity })
      },
      syncSettings: (settings) => {
        set(settings)
      },
      setActiveScene: (id) => {
        set((state) => ({
          activeSceneId: id,
          customPrompt: composeCustomPrompt(state.scenes, id)
        }))
      },
      updateScene: (id, update) => {
        set((state) => {
          const scenes = state.scenes.map((scene) =>
            scene.id === id ? { ...scene, ...update } : scene
          )
          return {
            scenes,
            customPrompt: composeCustomPrompt(scenes, state.activeSceneId)
          }
        })
      },
      updateScenePrompt: (id, prompt) => {
        set((state) => {
          const scenes = state.scenes.map((s) => (s.id === id ? { ...s, prompt } : s))
          return {
            scenes,
            customPrompt: composeCustomPrompt(scenes, state.activeSceneId)
          }
        })
      },
      addScene: (name) => {
        const id = `custom-${Date.now()}`
        set((state) => {
          const scenes = [
            ...state.scenes,
            {
              id,
              name,
              prompt: '',
              apiBaseURL: '',
              apiKey: '',
              model: '',
              reasoningEffort: 'default' as const,
              shortcut: '',
              isPreset: false
            }
          ]
          return {
            scenes,
            activeSceneId: id,
            customPrompt: composeCustomPrompt(scenes, id)
          }
        })
        return id
      },
      removeScene: (id) => {
        const scene = get().scenes.find((s) => s.id === id)
        if (!scene || scene.isPreset) return
        set((state) => {
          const scenes = state.scenes.filter((s) => s.id !== id)
          const activeSceneId = state.activeSceneId === id ? CODING_SCENE_ID : state.activeSceneId
          return {
            scenes,
            activeSceneId,
            customPrompt: composeCustomPrompt(scenes, activeSceneId)
          }
        })
      }
    }),
    {
      name: 'interview-coder-settings',
      version: 10,
      migrate: (persisted, version) => {
        const state = persisted as Partial<Settings>
        // Drop the legacy codeLanguage field (language now lives in the prompt text)
        delete (state as Record<string, unknown>).codeLanguage
        if (version < 8) {
          // Hover-delay options are now 0.5s / 1s / 2s; snap the retired ones
          // so the Select still matches an item
          if (state.toolbarHoverDelay === 800 || state.toolbarHoverDelay === 1200) {
            state.toolbarHoverDelay = 1000
          }
        }
        if (version < 5) {
          // Convert the legacy free-form customPrompt into a custom scene
          const scenes = createPresetScenes()
          let activeSceneId = CODING_SCENE_ID
          const legacyPrompt = (state.customPrompt ?? '').trim()
          if (legacyPrompt) {
            const id = `custom-${Date.now()}`
            scenes.push({
              id,
              name: '自定义场景',
              prompt: legacyPrompt,
              apiBaseURL: '',
              apiKey: '',
              model: '',
              reasoningEffort: 'default',
              shortcut: '',
              isPreset: false
            })
            activeSceneId = id
          }
          return { ...state, scenes, activeSceneId }
        }
        return state
      },
      merge: (persisted, current) => {
        const state = { ...current, ...(persisted as Partial<Settings>) }
        // Ensure preset scenes always exist (keep user-edited prompts),
        // so presets added in future versions show up for existing users
        const persistedScenes = Array.isArray(state.scenes) ? state.scenes : []
        state.scenes = [
          ...createPresetScenes().map((p) => {
            const saved = persistedScenes.find((s) => s.id === p.id)
            if (!saved) return p
            return {
              ...p,
              ...saved,
              // Restore the default prompt if a preset scene was left empty
              prompt: saved.prompt.trim() ? saved.prompt : p.prompt,
              apiBaseURL: typeof saved.apiBaseURL === 'string' ? saved.apiBaseURL : '',
              apiKey: typeof saved.apiKey === 'string' ? saved.apiKey : ''
            }
          }),
          ...persistedScenes
            .filter((s) => !s.isPreset)
            .map((scene) => ({
              ...scene,
              apiBaseURL: typeof scene.apiBaseURL === 'string' ? scene.apiBaseURL : '',
              apiKey: typeof scene.apiKey === 'string' ? scene.apiKey : '',
              model: typeof scene.model === 'string' ? scene.model : '',
              reasoningEffort: isReasoningEffort(scene.reasoningEffort)
                ? scene.reasoningEffort
                : ('default' as const),
              shortcut: typeof scene.shortcut === 'string' ? scene.shortcut : ''
            }))
        ]
        if (!state.scenes.some((s) => s.id === state.activeSceneId)) {
          state.activeSceneId = CODING_SCENE_ID
        }
        state.customPrompt = composeCustomPrompt(state.scenes, state.activeSceneId)
        return state
      }
    }
  )
)
