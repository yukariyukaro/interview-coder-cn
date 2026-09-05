import type { PromptScene } from './store/settings'

export const SCENE_CAPTURE_ACTION_PREFIX = 'captureScene:'

export function getSceneCaptureAction(sceneId: string): string {
  return `${SCENE_CAPTURE_ACTION_PREFIX}${encodeURIComponent(sceneId)}`
}

export function getSceneShortcuts(
  scenes: Array<Pick<PromptScene, 'id' | 'shortcut'>>
): Record<string, { action: string; key: string }> {
  return Object.fromEntries(
    scenes
      .filter((scene) => scene.shortcut.trim())
      .map((scene) => {
        const action = getSceneCaptureAction(scene.id)
        return [action, { action, key: scene.shortcut.trim() }]
      })
  )
}
