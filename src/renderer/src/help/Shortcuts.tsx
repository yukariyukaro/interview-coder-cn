import { Keyboard } from 'lucide-react'
import { useShortcutsStore } from '@/lib/store/shortcuts'
import { useSettingsStore } from '@/lib/store/settings'
import ShortcutRenderer from '@/components/ShortcutRenderer'
import { HelpSection } from './components'

export function Shortcuts() {
  return (
    <HelpSection
      Icon={Keyboard}
      title="快捷键"
      description="快捷键是操作应用的主要方式，您可以在设置中自定义快捷键。"
    >
      <ShortcutItemGroup category="Window Management" />
      <SceneShortcutItemGroup />
      <ShortcutItemGroup category="Screenshot & AI" />
      <ShortcutItemGroup category="Navigation" />
      <ShortcutItemGroup category="Window Movement" />
    </HelpSection>
  )
}

function SceneShortcutItemGroup() {
  const scenes = useSettingsStore((state) => state.scenes)
  const configuredScenes = scenes.filter((scene) => scene.shortcut)
  if (configuredScenes.length === 0) return null

  return (
    <div className="space-y-2">
      <h3 className="text-sm text-gray-500">场景截图</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {configuredScenes.map((scene) => (
          <ShortcutItem key={scene.id} action={`${scene.name}截图`} shortcutKey={scene.shortcut} />
        ))}
      </div>
    </div>
  )
}

function ShortcutItemGroup({ category }: { category: string }) {
  const { shortcuts } = useShortcutsStore()
  return (
    <div className="space-y-2">
      <h3 className="text-sm text-gray-500">{getCategoryName(category)}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.values(shortcuts)
          .filter((shortcut) => shortcut.category === category)
          .map((shortcut, index) => (
            <ShortcutItem key={index} action={shortcut.action} shortcutKey={shortcut.key} />
          ))}
      </div>
    </div>
  )
}

function ShortcutItem({ action, shortcutKey }: { action: string; shortcutKey: string }) {
  return (
    <div className="flex items-center justify-between rounded border border-gray-400 px-2 py-1">
      <span className="text-sm">{getShortcutDescription(action)}</span>
      <ShortcutRenderer shortcut={shortcutKey} className="select-none" />
    </div>
  )
}

const getCategoryName = (category: string) => {
  const categoryMap: Record<string, string> = {
    'Window Management': '窗口管理',
    'Screenshot & AI': '截图与AI',
    Navigation: '页面导航',
    'Window Movement': '窗口移动'
  }
  return categoryMap[category] || category
}

const getShortcutDescription = (action: string) => {
  const descriptionMap: Record<string, string> = {
    toggleSilentMode: '开启/关闭静默后台运行',
    hideOrShowMainWindow: '隐藏/显示窗口',
    ignoreOrEnableMouse: '鼠标穿透(窗口对鼠标隐身)',
    increaseOpacity: '提高不透明度(窗口更清晰)',
    decreaseOpacity: '提高透明度(窗口更透明)',
    takeScreenshot: '截图并生成解题建议（会新开对话）',
    appendScreenshot: '追加截图并生成解题建议',
    stopSolutionStream: '停止生成',
    toggleTranscription: '开始/暂停实时语音转录',
    clearTranscription: '清除转录文本（不提交给AI）',
    pageUp: '电脑与手机同步向上翻页',
    pageDown: '电脑与手机同步向下翻页',
    pageLeft: '电脑端向左翻页',
    pageRight: '电脑端向右翻页',
    moveMainWindowUp: '向上移动窗口',
    moveMainWindowDown: '向下移动窗口',
    moveMainWindowLeft: '向左移动窗口',
    moveMainWindowRight: '向右移动窗口'
  }
  return descriptionMap[action] || action
}
