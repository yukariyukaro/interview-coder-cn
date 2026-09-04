import type { PairingPayload } from '@interview-coder/sync-protocol'
import { KeyRound, Link2, QrCode, Server } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import type { ConnectionSettings } from '../storage/connection-settings'
import { PairingScanner } from './PairingScanner'

type ConnectionPanelProps = {
  settings: ConnectionSettings | null
  onSave: (settings: ConnectionSettings) => Promise<void>
}

export function ConnectionPanel({ settings, onSave }: ConnectionPanelProps) {
  const [serverUrl, setServerUrl] = useState(settings?.serverUrl ?? '')
  const [pairingCode, setPairingCode] = useState(settings?.pairingCode ?? '')
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)

  useEffect(() => {
    if (!settings) return
    setServerUrl(settings.serverUrl)
    setPairingCode(settings.pairingCode)
  }, [settings])

  const persistSettings = async (nextSettings: ConnectionSettings, propagateError = false) => {
    if (!nextSettings.serverUrl || !nextSettings.pairingCode) {
      setErrorMessage('请填写服务器地址和配对码')
      return
    }

    setIsSaving(true)
    setErrorMessage(null)
    try {
      await onSave(nextSettings)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '连接设置保存失败')
      if (propagateError) throw error
    } finally {
      setIsSaving(false)
    }
  }

  const save = async () => {
    await persistSettings({
      serverUrl: serverUrl.trim(),
      pairingCode: pairingCode.trim()
    })
  }

  const saveScannedPairing = async (payload: PairingPayload) => {
    const nextSettings = {
      serverUrl: payload.serverUrl,
      pairingCode: payload.pairingCode
    }
    await persistSettings(nextSettings, true)
    setServerUrl(nextSettings.serverUrl)
    setPairingCode(nextSettings.pairingCode)
  }

  return (
    <>
      <View style={styles.panel}>
        <View style={styles.headingRow}>
          <View style={styles.headingTitle}>
            <Link2 color="#8fa2b7" size={17} strokeWidth={1.8} />
            <Text style={styles.heading}>连接设置</Text>
          </View>
          <Text style={styles.storageHint}>安全存储</Text>
        </View>

        <View style={styles.fields}>
          <Pressable
            accessibilityRole="button"
            disabled={isSaving}
            onPress={() => setScannerOpen(true)}
            style={({ pressed }) => [
              styles.scanButton,
              pressed && styles.scanButtonPressed,
              isSaving && styles.buttonDisabled
            ]}
          >
            <QrCode color="#07110e" size={17} strokeWidth={2.2} />
            <Text style={styles.buttonText}>扫描电脑端二维码</Text>
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.dividerText}>手动连接</Text>
            <View style={styles.divider} />
          </View>

          <View style={styles.field}>
            <Server color="#65758b" size={16} strokeWidth={1.8} />
            <TextInput
              accessibilityLabel="服务器地址"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={setServerUrl}
              placeholder="wss://sync.example.com"
              placeholderTextColor="#596579"
              selectionColor="#3dd6a4"
              style={styles.input}
              value={serverUrl}
            />
          </View>
          <View style={styles.field}>
            <KeyRound color="#65758b" size={16} strokeWidth={1.8} />
            <TextInput
              accessibilityLabel="配对码"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setPairingCode}
              placeholder="输入手机配对码"
              placeholderTextColor="#596579"
              secureTextEntry
              selectionColor="#3dd6a4"
              style={styles.input}
              value={pairingCode}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={isSaving}
            onPress={save}
            style={({ pressed }) => [
              styles.manualButton,
              pressed && styles.manualButtonPressed,
              isSaving && styles.buttonDisabled
            ]}
          >
            {isSaving ? (
              <ActivityIndicator color="#dce5ef" size="small" />
            ) : (
              <Text style={styles.manualButtonText}>保存并连接</Text>
            )}
          </Pressable>
        </View>

        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      </View>

      <PairingScanner
        onClose={() => setScannerOpen(false)}
        onPair={saveScannedPairing}
        visible={scannerOpen}
      />
    </>
  )
}

const styles = StyleSheet.create({
  panel: {
    borderTopColor: '#263142',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 10
  },
  headingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10
  },
  headingTitle: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7
  },
  heading: {
    color: '#dce5ef',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0
  },
  storageHint: {
    color: '#65758b',
    fontSize: 11
  },
  fields: {
    gap: 8
  },
  field: {
    alignItems: 'center',
    backgroundColor: '#0b111b',
    borderColor: '#263142',
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    minHeight: 42,
    paddingHorizontal: 12
  },
  input: {
    color: '#dce5ef',
    flex: 1,
    fontSize: 13,
    paddingVertical: 9
  },
  scanButton: {
    alignItems: 'center',
    backgroundColor: '#3dd6a4',
    borderRadius: 6,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 42
  },
  scanButtonPressed: {
    backgroundColor: '#31bd91'
  },
  buttonDisabled: {
    opacity: 0.55
  },
  buttonText: {
    color: '#07110e',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0
  },
  dividerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 2
  },
  divider: {
    backgroundColor: '#263142',
    flex: 1,
    height: StyleSheet.hairlineWidth
  },
  dividerText: {
    color: '#65758b',
    fontSize: 10
  },
  manualButton: {
    alignItems: 'center',
    borderColor: '#344258',
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 42
  },
  manualButtonPressed: {
    backgroundColor: '#17212e'
  },
  manualButtonText: {
    color: '#dce5ef',
    fontSize: 13,
    fontWeight: '600'
  },
  error: {
    color: '#ff8d86',
    fontSize: 12,
    marginTop: 8
  }
})
