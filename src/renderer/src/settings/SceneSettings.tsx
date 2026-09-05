import { useState } from 'react'
import { Eye, EyeOff, Plus, RotateCcw, SquareTerminal, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { PRESET_SCENE_PROMPTS, type ReasoningEffort, useSettingsStore } from '@/lib/store/settings'

import { SelectModel } from './SelectModel'
import { ShortcutRecorder } from './ShortcutRecorder'

export function SceneSettingsSection() {
  const {
    scenes,
    activeSceneId,
    setActiveScene,
    updateScene,
    updateScenePrompt,
    addScene,
    removeScene
  } = useSettingsStore()
  const [addSceneOpen, setAddSceneOpen] = useState(false)
  const [newSceneName, setNewSceneName] = useState('')
  const [sceneToDelete, setSceneToDelete] = useState<string | null>(null)
  const [showSceneApiKey, setShowSceneApiKey] = useState(false)
  const activeScene = scenes.find((scene) => scene.id === activeSceneId)
  const deletingScene = scenes.find((scene) => scene.id === sceneToDelete)

  const handleAddScene = () => {
    const name = newSceneName.trim()
    if (!name) return
    addScene(name)
    setNewSceneName('')
    setAddSceneOpen(false)
  }

  const handleResetScenePrompt = () => {
    if (!activeScene?.isPreset) return
    updateScenePrompt(activeScene.id, PRESET_SCENE_PROMPTS[activeScene.id] ?? '')
  }

  return (
    <>
      <div className="bg-gray-300/80 rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center">
          <SquareTerminal className="h-5 w-5 mr-2" />
          解题设置
        </h2>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">
              使用场景
              <span className="ml-2 text-xs font-light">
                每个场景可独立配置快捷键、模型、推理强度和系统提示词
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {scenes.map((scene) => (
                <div
                  key={scene.id}
                  className={cn(
                    'group flex items-center rounded-full border text-sm transition-colors cursor-pointer select-none',
                    scene.id === activeSceneId
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-gray-300 hover:border-blue-400'
                  )}
                  onClick={() => setActiveScene(scene.id)}
                >
                  <span className={cn('py-1 pl-3', scene.isPreset ? 'pr-3' : 'pr-1')}>
                    {scene.name}
                  </span>
                  {!scene.isPreset && (
                    <button
                      className="mr-1.5 p-0.5 rounded-full opacity-60 hover:opacity-100 hover:bg-black/10"
                      title="删除该场景"
                      onClick={(event) => {
                        event.stopPropagation()
                        setSceneToDelete(scene.id)
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
              <button
                className="flex items-center gap-1 rounded-full border border-dashed border-gray-400 bg-transparent px-3 py-1 text-sm text-gray-600 hover:border-blue-500 hover:text-blue-600 transition-colors"
                onClick={() => setAddSceneOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                新增场景
              </button>
            </div>
          </div>

          {activeScene && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <label className="text-sm font-medium">
                  场景 API Base URL
                  <span className="ml-2 text-xs font-light">留空时使用 AI 设置中的默认地址</span>
                </label>
                <Input
                  value={activeScene.apiBaseURL}
                  onChange={(event) =>
                    updateScene(activeScene.id, { apiBaseURL: event.target.value })
                  }
                  className="w-60 bg-white"
                  placeholder="继承默认 Base URL"
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <label className="text-sm font-medium">
                  场景 API Key
                  <span className="ml-2 text-xs font-light">留空时使用 AI 设置中的默认 Key</span>
                </label>
                <div className="flex items-center w-60">
                  <Input
                    type={showSceneApiKey ? 'text' : 'password'}
                    value={activeScene.apiKey}
                    onChange={(event) =>
                      updateScene(activeScene.id, { apiKey: event.target.value })
                    }
                    className="flex-1 rounded-r-none bg-white"
                    placeholder="继承默认 API Key"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowSceneApiKey(!showSceneApiKey)}
                    className="border border-l-0 rounded-l-none rounded-r-md h-9 w-9 hover:border-none"
                  >
                    {showSceneApiKey ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <label className="text-sm font-medium">
                  场景模型
                  <span className="ml-2 text-xs font-light">留空时使用默认模型</span>
                </label>
                <SelectModel
                  value={activeScene.model}
                  onChange={(model) => updateScene(activeScene.id, { model })}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <label className="text-sm font-medium">
                  Reasoning effort
                  <span className="ml-2 text-xs font-light">仅对支持该参数的推理模型生效</span>
                </label>
                <Select
                  value={activeScene.reasoningEffort}
                  onValueChange={(reasoningEffort) =>
                    updateScene(activeScene.id, {
                      reasoningEffort: reasoningEffort as ReasoningEffort
                    })
                  }
                >
                  <SelectTrigger className="w-60 bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">模型默认</SelectItem>
                    <SelectItem value="minimal">Minimal</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between gap-4">
                <label className="text-sm font-medium">
                  场景截图快捷键
                  <span className="ml-2 text-xs font-light">
                    按下后切换到「{activeScene.name}」并新开截图对话
                  </span>
                </label>
                <ShortcutRecorder
                  value={activeScene.shortcut}
                  onChange={(shortcut) => updateScene(activeScene.id, { shortcut })}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium">
                    系统提示词
                    <span className="ml-2 text-xs font-light">「{activeScene.name}」场景</span>
                  </label>
                  {activeScene.isPreset && (
                    <button
                      className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 transition-colors"
                      title="恢复该场景的默认提示词"
                      onClick={handleResetScenePrompt}
                    >
                      <RotateCcw className="h-3 w-3" />
                      恢复默认
                    </button>
                  )}
                </div>
                <Textarea
                  value={activeScene.prompt}
                  onChange={(event) => updateScenePrompt(activeScene.id, event.target.value)}
                  placeholder="请输入该场景的系统提示词"
                  className="w-full min-h-24 max-h-100 bg-white"
                  rows={6}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={addSceneOpen} onOpenChange={setAddSceneOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>新增场景</DialogTitle>
            <DialogDescription>创建后可配置专属快捷键、模型和提示词</DialogDescription>
          </DialogHeader>
          <Input
            value={newSceneName}
            onChange={(event) => setNewSceneName(event.target.value)}
            placeholder="场景名称，如：数学考试"
            maxLength={20}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleAddScene()
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddSceneOpen(false)}>
              取消
            </Button>
            <Button onClick={handleAddScene} disabled={!newSceneName.trim()}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!sceneToDelete} onOpenChange={(open) => !open && setSceneToDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除场景</DialogTitle>
            <DialogDescription>
              确定删除场景「{deletingScene?.name}」吗？其配置将一并删除，且无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSceneToDelete(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (sceneToDelete) removeScene(sceneToDelete)
                setSceneToDelete(null)
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
