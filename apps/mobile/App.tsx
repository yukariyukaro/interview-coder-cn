import { CircleAlert, LoaderCircle, Wifi, WifiOff } from 'lucide-react-native'
import { useEffect, useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'

import { ConnectionPanel } from './src/components/ConnectionPanel'
import { SolutionView } from './src/components/SolutionView'
import {
  loadConnectionSettings,
  saveConnectionSettings,
  type ConnectionSettings
} from './src/storage/connection-settings'
import { getNextPageOffset } from './src/sync/page-scroll'
import { useSyncConnection, type ConnectionState } from './src/sync/use-sync-connection'

const connectionLabels: Record<ConnectionState['status'], string> = {
  disconnected: '未连接',
  connecting: '连接中',
  connected: '已连接',
  error: '连接异常'
}

function ConnectionIcon({ state }: { state: ConnectionState }) {
  switch (state.status) {
    case 'connected':
      return <Wifi color="#3dd6a4" size={17} strokeWidth={2} />
    case 'connecting':
      return <LoaderCircle color="#e9c46a" size={17} strokeWidth={2} />
    case 'error':
      return <CircleAlert color="#ff8d86" size={17} strokeWidth={2} />
    case 'disconnected':
      return <WifiOff color="#718096" size={17} strokeWidth={2} />
  }
}

function Workspace() {
  const [settings, setSettings] = useState<ConnectionSettings | null>(null)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null)
  const { connectionState, sessionState, scrollCommand, reconnect } = useSyncConnection(
    settingsLoaded ? settings : null
  )
  const scrollViewRef = useRef<ScrollView>(null)
  const viewportHeightRef = useRef(0)
  const contentHeightRef = useRef(0)
  const currentOffsetRef = useRef(0)
  const targetOffsetRef = useRef(0)
  const remoteScrollInProgressRef = useRef(false)

  useEffect(() => {
    let active = true

    loadConnectionSettings()
      .then((storedSettings) => {
        if (active) setSettings(storedSettings)
      })
      .catch((error) => {
        if (!active) return
        setSettingsLoadError(error instanceof Error ? error.message : '读取连接设置失败')
      })
      .finally(() => {
        if (active) setSettingsLoaded(true)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!scrollCommand || !scrollViewRef.current) return
    const target = getNextPageOffset({
      direction: scrollCommand.direction,
      currentOffset: remoteScrollInProgressRef.current
        ? targetOffsetRef.current
        : currentOffsetRef.current,
      viewportHeight: viewportHeightRef.current,
      contentHeight: contentHeightRef.current
    })
    targetOffsetRef.current = target
    remoteScrollInProgressRef.current = true
    scrollViewRef.current.scrollTo({ y: target, animated: true })
  }, [scrollCommand])

  const updateSettings = async (nextSettings: ConnectionSettings) => {
    await saveConnectionSettings(nextSettings)
    setSettingsLoadError(null)
    setSettings(nextSettings)
    reconnect()
  }

  const displayedConnectionState: ConnectionState = settingsLoaded
    ? connectionState
    : { status: 'connecting' }

  const settleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.y
    currentOffsetRef.current = offset
    targetOffsetRef.current = offset
    remoteScrollInProgressRef.current = false
  }

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.workspace}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={(_width, height) => {
            contentHeightRef.current = height
            const maxOffset = Math.max(0, height - viewportHeightRef.current)
            targetOffsetRef.current = Math.min(targetOffsetRef.current, maxOffset)
          }}
          onLayout={(event) => {
            viewportHeightRef.current = event.nativeEvent.layout.height
          }}
          onMomentumScrollEnd={settleScroll}
          onScroll={(event) => {
            const offset = event.nativeEvent.contentOffset.y
            currentOffsetRef.current = offset
            if (!remoteScrollInProgressRef.current) targetOffsetRef.current = offset
          }}
          onScrollBeginDrag={() => {
            remoteScrollInProgressRef.current = false
          }}
          onScrollEndDrag={settleScroll}
          ref={scrollViewRef}
          scrollEventThrottle={16}
          testID="workspace-scroll"
        >
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>INTERVIEW CODER</Text>
              <Text style={styles.title}>同步工作台</Text>
            </View>
            <View
              accessibilityLabel={`连接状态：${connectionLabels[displayedConnectionState.status]}`}
            >
              <View style={styles.connectionStatus}>
                <ConnectionIcon state={displayedConnectionState} />
                <Text
                  style={[
                    styles.connectionText,
                    displayedConnectionState.status === 'connected' &&
                      styles.connectionTextConnected,
                    displayedConnectionState.status === 'error' && styles.connectionTextError
                  ]}
                >
                  {connectionLabels[displayedConnectionState.status]}
                </Text>
              </View>
              {displayedConnectionState.status === 'error' ? (
                <Text numberOfLines={2} style={styles.connectionError}>
                  {displayedConnectionState.message}
                </Text>
              ) : null}
            </View>
          </View>

          {settingsLoadError ? (
            <View accessibilityRole="alert" style={styles.settingsError}>
              <Text style={styles.settingsErrorText}>{settingsLoadError}</Text>
            </View>
          ) : null}

          <SolutionView session={sessionState} />
          <ConnectionPanel settings={settings} onSave={updateSettings} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Workspace />
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: '#080d14',
    flex: 1
  },
  workspace: {
    backgroundColor: '#0d141e',
    flex: 1
  },
  scrollContent: {
    flexGrow: 1
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
  connectionStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'flex-end'
  },
  connectionText: {
    color: '#8fa2b7',
    fontSize: 12,
    fontWeight: '600'
  },
  connectionTextConnected: {
    color: '#65e3bb'
  },
  connectionTextError: {
    color: '#ffaaa5'
  },
  connectionError: {
    color: '#b86f6b',
    fontSize: 10,
    marginTop: 3,
    maxWidth: 170,
    textAlign: 'right'
  },
  settingsError: {
    backgroundColor: '#241719',
    borderBottomColor: '#5c2a2e',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingVertical: 9
  },
  settingsErrorText: {
    color: '#ffaaa5',
    fontSize: 12
  }
})
