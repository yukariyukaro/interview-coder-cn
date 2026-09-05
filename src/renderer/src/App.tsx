import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, useLocation } from 'react-router'
import { Toaster } from 'sonner'
import CoderPage from '@/coder'
import SettingsPage from '@/settings'
import HelpPage from '@/help'
import { OverlayToolbar } from '@/coder/OverlayToolbar'
import { useSettingsStore } from '@/lib/store/settings'
import { useShortcutsStore } from '@/lib/store/shortcuts'
import { getCloneableFields } from '@/lib/utils'
import { WindowResizeHandles } from '@/components/WindowResizeHandles'
import { shouldBootstrapMainRenderer } from '@/renderer-bootstrap'
import { getSceneShortcuts } from '@/lib/scene-shortcuts'

export default function App() {
  const [initialized, setInitialized] = useState(false)
  const settingsStore = useSettingsStore()
  const updateSetting = useSettingsStore((state) => state.updateSetting)
  const setActiveScene = useSettingsStore((state) => state.setActiveScene)
  const scenes = useSettingsStore((state) => state.scenes)
  const colorMode = useSettingsStore((state) => state.colorMode)
  const { shortcuts } = useShortcutsStore()
  const isMainRenderer = shouldBootstrapMainRenderer(window.location.hash)
  const sceneShortcutSignature = scenes
    .map((scene) => `${scene.id}\u0000${scene.shortcut}`)
    .join('\u0001')

  useEffect(() => {
    if (!isMainRenderer) return
    document.documentElement.dataset.theme = colorMode
  }, [colorMode, isMainRenderer])

  useEffect(() => {
    if (!isMainRenderer) return
    window.api.getAppSettings().then((settings) => {
      const blankFields = Object.keys(settings).filter(
        (key) => settings[key] && !settingsStore[key]
      )
      settingsStore.syncSettings(
        blankFields.reduce(
          (acc, key) => {
            acc[key] = settings[key]
            return acc
          },
          {} as Partial<typeof settingsStore>
        )
      )
      setInitialized(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMainRenderer])

  useEffect(() => {
    if (isMainRenderer && initialized) {
      window.api.updateAppSettings(getCloneableFields(settingsStore))
    }
  }, [initialized, isMainRenderer, settingsStore])

  useEffect(() => {
    if (!isMainRenderer) return
    window.api.onSilentModeChanged((enabled) => {
      updateSetting('silentMode', enabled)
    })
    return () => {
      window.api.removeSilentModeChangedListener()
    }
  }, [isMainRenderer, updateSetting])

  useEffect(() => {
    if (!isMainRenderer) return
    window.api.onActiveSceneChanged((sceneId) => {
      setActiveScene(sceneId)
    })
    return () => {
      window.api.removeActiveSceneChangedListener()
    }
  }, [isMainRenderer, setActiveScene])

  useEffect(() => {
    if (!isMainRenderer || !initialized) return
    const sceneShortcuts = getSceneShortcuts(useSettingsStore.getState().scenes)
    void window.api.initShortcuts({ ...shortcuts, ...sceneShortcuts })
  }, [initialized, isMainRenderer, sceneShortcutSignature, shortcuts])

  return (
    <>
      <HashRouter>
        <ToolbarVisibilityController />
        <WindowResizeController />
        <Routes>
          <Route index element={<CoderPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="help" element={<HelpPage />} />
          <Route path="toolbar" element={<OverlayToolbar />} />
        </Routes>
      </HashRouter>

      <Toaster />
    </>
  )
}

/** The toolbar window renders its own handles; this covers the main window's routes */
function WindowResizeController() {
  const location = useLocation()
  const resizable = useSettingsStore((state) => state.resizable)

  if (location.pathname === '/toolbar') return null
  return <WindowResizeHandles enabled={resizable} />
}

function ToolbarVisibilityController() {
  const location = useLocation()
  const showOverlayToolbar = useSettingsStore((state) => state.showOverlayToolbar)

  useEffect(() => {
    // The toolbar window renders this app too, but must not drive its own visibility
    if (location.pathname === '/toolbar') return
    void window.api.setToolbarVisible(location.pathname === '/' && showOverlayToolbar)
  }, [location.pathname, showOverlayToolbar])

  return null
}
