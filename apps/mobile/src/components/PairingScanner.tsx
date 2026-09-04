import { parsePairingPayload, type PairingPayload } from '@interview-coder/sync-protocol'
import { CameraView, type BarcodeScanningResult, useCameraPermissions } from 'expo-camera'
import { ScanLine, X } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

type PairingScannerProps = {
  visible: boolean
  onClose: () => void
  onPair: (payload: PairingPayload) => Promise<void>
}

export function PairingScanner({ visible, onClose, onPair }: PairingScannerProps) {
  const [permission, requestPermission] = useCameraPermissions()
  const [isProcessing, setIsProcessing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) return
    setIsProcessing(false)
    setErrorMessage(null)
    if (!permission || permission.status === 'undetermined') {
      void requestPermission()
    }
  }, [permission, requestPermission, visible])

  const handleBarcodeScanned = async ({ data }: BarcodeScanningResult) => {
    if (isProcessing) return

    setIsProcessing(true)
    setErrorMessage(null)
    const parsed = parsePairingPayload(data)
    if (!parsed.success) {
      setErrorMessage('二维码不是有效的截屏解题助手配对信息')
      return
    }

    try {
      await onPair(parsed.data)
      onClose()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '保存配对信息失败')
    }
  }

  const resumeScanning = () => {
    setErrorMessage(null)
    setIsProcessing(false)
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} visible={visible}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>PAIR DEVICE</Text>
            <Text style={styles.title}>扫描电脑端二维码</Text>
          </View>
          <Pressable
            accessibilityLabel="关闭扫码"
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
          >
            <X color="#dce5ef" size={20} />
          </Pressable>
        </View>

        <View style={styles.cameraRegion}>
          {permission?.granted ? (
            <CameraView
              accessibilityLabel="二维码扫描相机"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              facing="back"
              onBarcodeScanned={isProcessing ? undefined : handleBarcodeScanned}
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View style={styles.permissionState}>
              {!permission || permission.status === 'undetermined' ? (
                <ActivityIndicator color="#3dd6a4" size="large" />
              ) : (
                <>
                  <ScanLine color="#65758b" size={34} strokeWidth={1.5} />
                  <Text style={styles.permissionTitle}>需要相机权限</Text>
                  <Text style={styles.permissionDescription}>
                    允许访问相机后即可扫描电脑端生成的配对二维码。
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void requestPermission()}
                    style={({ pressed }) => [
                      styles.permissionButton,
                      pressed && styles.permissionButtonPressed
                    ]}
                  >
                    <Text style={styles.permissionButtonText}>授权相机</Text>
                  </Pressable>
                </>
              )}
            </View>
          )}

          {permission?.granted ? (
            <View pointerEvents="none" style={styles.scanGuide}>
              <View style={styles.scanFrame} />
              <Text style={styles.scanHint}>将电脑端二维码置于框内</Text>
            </View>
          ) : null}
        </View>

        {errorMessage ? (
          <View accessibilityRole="alert" style={styles.errorArea}>
            <Text style={styles.errorText}>{errorMessage}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={resumeScanning}
              style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
            >
              <Text style={styles.retryButtonText}>重新扫描</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={styles.footerText}>
            配对信息只会保存到当前设备的安全存储，不包含 AI Key 或截图。
          </Text>
        )}
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#080d14',
    flex: 1
  },
  header: {
    alignItems: 'center',
    borderBottomColor: '#263142',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 76,
    paddingHorizontal: 18,
    paddingVertical: 12
  },
  eyebrow: {
    color: '#596579',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0
  },
  title: {
    color: '#eef3f8',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0,
    marginTop: 3
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: '#17212e',
    borderRadius: 6,
    height: 40,
    justifyContent: 'center',
    width: 40
  },
  iconButtonPressed: {
    backgroundColor: '#223043'
  },
  cameraRegion: {
    backgroundColor: '#06090e',
    flex: 1,
    overflow: 'hidden'
  },
  permissionState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 36
  },
  permissionTitle: {
    color: '#dce5ef',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 16
  },
  permissionDescription: {
    color: '#8fa2b7',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
    textAlign: 'center'
  },
  permissionButton: {
    backgroundColor: '#3dd6a4',
    borderRadius: 6,
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 12
  },
  permissionButtonPressed: {
    backgroundColor: '#31bd91'
  },
  permissionButtonText: {
    color: '#07110e',
    fontSize: 13,
    fontWeight: '700'
  },
  scanGuide: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  scanFrame: {
    borderColor: '#65e3bb',
    borderRadius: 6,
    borderWidth: 2,
    height: 248,
    width: 248
  },
  scanHint: {
    backgroundColor: '#080d14cc',
    borderRadius: 4,
    color: '#eef3f8',
    fontSize: 13,
    marginTop: 18,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  errorArea: {
    alignItems: 'center',
    backgroundColor: '#241719',
    borderTopColor: '#5c2a2e',
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 18
  },
  errorText: {
    color: '#ffaaa5',
    fontSize: 12,
    textAlign: 'center'
  },
  retryButton: {
    borderColor: '#814348',
    borderRadius: 6,
    borderWidth: 1,
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 9
  },
  retryButtonPressed: {
    backgroundColor: '#321e21'
  },
  retryButtonText: {
    color: '#ffb8b3',
    fontSize: 12,
    fontWeight: '600'
  },
  footerText: {
    color: '#65758b',
    fontSize: 11,
    lineHeight: 17,
    paddingHorizontal: 22,
    paddingVertical: 16,
    textAlign: 'center'
  }
})
