import { FolderOpen } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { useSettingsStore } from '@/lib/store/settings'

export function LocalSaveSettings() {
  const { screenshotAutoSave, answerAutoSave, screenshotDir, updateSetting } = useSettingsStore()
  const localSaveEnabled = screenshotAutoSave || answerAutoSave

  return (
    <div className="bg-gray-300/80 rounded-lg p-6">
      <h2 className="text-lg font-semibold mb-4 flex items-center">
        <FolderOpen className="h-5 w-5 mr-2" />
        本地保存
      </h2>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">
            自动保存截图
            <span className="ml-2 text-xs font-light">开启后，每次截图都会自动保存为 PNG</span>
          </label>
          <Switch
            className="scale-y-90"
            checked={screenshotAutoSave}
            onCheckedChange={(checked) => updateSetting('screenshotAutoSave', checked)}
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">
            自动保存 AI 回答
            <span className="ml-2 text-xs font-light">
              每次生成完成后，将当前会话的完整回答更新为 Markdown 文件
            </span>
          </label>
          <Switch
            className="scale-y-90"
            checked={answerAutoSave}
            onCheckedChange={(checked) => updateSetting('answerAutoSave', checked)}
          />
        </div>

        {localSaveEnabled && (
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">
              保存目录
              <span className="ml-2 text-xs font-light">
                截图与回答共用此目录（选择弹窗可能被本窗口遮挡）
              </span>
            </label>
            <button
              className="text-xs text-gray-600 max-w-48 truncate hover:text-gray-900 cursor-pointer transition-colors"
              title="点击选择保存目录"
              onClick={async () => {
                const dir = await window.api.selectScreenshotDir()
                if (dir) updateSetting('screenshotDir', dir)
              }}
            >
              {screenshotDir || '默认: 图片/InterviewCoder'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
