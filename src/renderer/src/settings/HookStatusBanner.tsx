import { ShieldCheck } from 'lucide-react'
import { useHookStatusStore, type HookStatus } from '@/lib/store/hook'

function describeStatus(status: HookStatus): { tone: 'ok' | 'warn'; text: string } {
  if (status.available) {
    return {
      tone: 'ok',
      text: '无痕快捷键已启用：使用右侧修饰键（Win 右 Ctrl / macOS 右 ⌥、右 ⌘）的快捷键，按键不会被前台页面检测到。'
    }
  }
  if (status.reason === 'unused') {
    return {
      tone: 'ok',
      text: '把快捷键录成「右 Ctrl + 字母」这种形式（或 macOS 的右 ⌥ / 右 ⌘），即可让按键不会被前台页面检测到。'
    }
  }
  const degraded = '相关快捷键已回退为左侧修饰键，功能不受影响，但按下的修饰键会泄漏给前台页面。'
  switch (status.reason) {
    case 'no-addon':
      return { tone: 'warn', text: `未检测到无痕组件（原生插件未编译或缺失），${degraded}` }
    case 'permission-denied':
      return {
        tone: 'warn',
        text: `macOS 未授予「辅助功能 / 输入监控」权限，${degraded}请在系统设置中授权后重启应用。`
      }
    case 'unsupported-platform':
      return { tone: 'warn', text: `当前平台不支持无痕快捷键，${degraded}` }
    default:
      return { tone: 'warn', text: `无痕组件安装失败，${degraded}` }
  }
}

export function HookStatusBanner() {
  const status = useHookStatusStore()
  const { tone, text } = describeStatus(status)

  return (
    <div
      className={`mb-4 flex items-start gap-2 rounded-md px-3 py-2 text-xs ${
        tone === 'ok' ? 'bg-emerald-100/70 text-emerald-800' : 'bg-amber-100/70 text-amber-800'
      }`}
    >
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{text}</p>
    </div>
  )
}
