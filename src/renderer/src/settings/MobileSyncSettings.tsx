import { createPairingPayload } from '@interview-coder/sync-protocol'
import { Copy, Network, RefreshCw } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useSettingsStore } from '@/lib/store/settings'
import { deriveMobilePairingCode } from '@/lib/sync-pairing'

export function MobileSyncSettings() {
  const { syncEnabled, syncServerUrl, syncPairingCode, updateSetting } = useSettingsStore()
  const [mobilePairingCode, setMobilePairingCode] = useState('')
  const [mobileSyncServerUrl, setMobileSyncServerUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void deriveMobilePairingCode(syncPairingCode).then((pairingCode) => {
      if (active) setMobilePairingCode(pairingCode)
    })
    return () => {
      active = false
    }
  }, [syncPairingCode])

  useEffect(() => {
    let active = true
    void window.api.getMobileSyncServerUrl(syncServerUrl).then((serverUrl) => {
      if (active) setMobileSyncServerUrl(serverUrl)
    })
    return () => {
      active = false
    }
  }, [syncServerUrl])

  const pairingPayload = createPairingPayload({
    serverUrl: mobileSyncServerUrl ?? '',
    pairingCode: mobilePairingCode
  })

  const generatePairingCode = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    updateSetting(
      'syncPairingCode',
      Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
    )
  }

  return (
    <div className="bg-gray-300/80 rounded-lg p-6">
      <h2 className="text-lg font-semibold mb-4 flex items-center">
        <Network className="h-5 w-5 mr-2" />
        移动端同步
      </h2>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">
            启用同步
            <span className="ml-2 text-xs font-light">
              仅同步截图数量和解题文本，不会发送截图或 AI Key
            </span>
          </label>
          <Switch
            className="scale-y-90"
            checked={syncEnabled}
            onCheckedChange={(checked) => updateSetting('syncEnabled', checked)}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <label className="text-sm font-medium">同步服务地址</label>
          <Input
            type="url"
            value={syncServerUrl}
            onChange={(event) => updateSetting('syncServerUrl', event.target.value)}
            className="w-60 bg-white"
            placeholder="wss://sync.example.com"
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <label className="text-sm font-medium">桌面密钥</label>
          <div className="flex w-60 items-center gap-2">
            <Input
              value={syncPairingCode}
              onChange={(event) => updateSetting('syncPairingCode', event.target.value)}
              className="min-w-0 flex-1 bg-white"
              placeholder="输入 32-64 位密钥"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              title="生成安全桌面密钥"
              onClick={generatePairingCode}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <label className="text-sm font-medium">手机配对码</label>
          <div className="flex w-60 items-center gap-2">
            <Input
              value={mobilePairingCode}
              readOnly
              className="min-w-0 flex-1 bg-white"
              placeholder="桌面密钥有效后生成"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              title="复制手机配对码"
              disabled={!mobilePairingCode}
              onClick={() => void navigator.clipboard.writeText(mobilePairingCode)}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex items-start justify-between gap-4 border-t border-gray-500/30 pt-4">
          <div>
            <div className="text-sm font-medium">扫码配对</div>
            <p className="mt-1 max-w-72 text-xs font-light">
              使用手机端“扫描电脑端二维码”，自动保存连接地址和配对凭据。
            </p>
          </div>
          {syncEnabled && pairingPayload ? (
            <div className="rounded-md bg-white p-3">
              <QRCodeSVG
                bgColor="#ffffff"
                fgColor="#111827"
                level="M"
                size={164}
                title="移动端配对二维码"
                value={pairingPayload}
              />
            </div>
          ) : (
            <div className="w-60 rounded-md border border-gray-400/60 px-4 py-6 text-center text-xs">
              {syncEnabled
                ? '填写有效的同步服务地址并生成桌面密钥后显示二维码'
                : '启用移动端同步后显示二维码'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
