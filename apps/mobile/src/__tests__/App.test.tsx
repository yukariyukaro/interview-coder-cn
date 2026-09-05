import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { createPairingPayload } from '@interview-coder/sync-protocol'
import { ScrollView } from 'react-native'

import App from '../../App'
import { loadConnectionSettings, saveConnectionSettings } from '../storage/connection-settings'
import { initialSessionState, type SessionState } from '../sync/session-reducer'
import { useSyncConnection } from '../sync/use-sync-connection'

jest.mock('../storage/connection-settings', () => ({
  loadConnectionSettings: jest.fn(),
  saveConnectionSettings: jest.fn()
}))

jest.mock('../sync/use-sync-connection', () => ({
  useSyncConnection: jest.fn()
}))

jest.mock('expo-camera', () => {
  const React = jest.requireActual('react')
  const { View } = jest.requireActual('react-native')

  return {
    CameraView: (props: Record<string, unknown>) => React.createElement(View, props),
    useCameraPermissions: () => [
      { granted: true, status: 'granted' },
      jest.fn().mockResolvedValue({ granted: true, status: 'granted' })
    ]
  }
})

jest.mock('react-native-safe-area-context', () => {
  const React = jest.requireActual('react')
  const { View } = jest.requireActual('react-native')
  const SafeAreaContainer = ({ children }: { children: React.ReactNode }) =>
    React.createElement(View, null, children)

  return {
    SafeAreaProvider: SafeAreaContainer,
    SafeAreaView: SafeAreaContainer
  }
})

const mockLoadConnectionSettings = jest.mocked(loadConnectionSettings)
const mockSaveConnectionSettings = jest.mocked(saveConnectionSettings)
const mockUseSyncConnection = jest.mocked(useSyncConnection)
const MOBILE_PAIRING_CODE = '69c56adc3602a8564f055aad589f18b9ba0b50ce8058eed0a95f491a541e92bf'

describe('App', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLoadConnectionSettings.mockResolvedValue(null)
    mockSaveConnectionSettings.mockResolvedValue()
    mockUseSyncConnection.mockReturnValue({
      connectionState: { status: 'disconnected' },
      sessionState: initialSessionState,
      scrollCommand: null,
      reconnect: jest.fn()
    })
  })

  it('配置缺失时展示未连接状态和连接设置', async () => {
    await render(<App />)

    await waitFor(() => {
      expect(screen.getByText('未连接')).toBeOnTheScreen()
    })
    expect(screen.getByText('等待解题结果')).toBeOnTheScreen()
    expect(screen.getByLabelText('服务器地址')).toBeOnTheScreen()
    expect(screen.getByLabelText('配对码')).toBeOnTheScreen()
    expect(mockUseSyncConnection).toHaveBeenLastCalledWith(null)
  })

  it('连接后展示 Markdown 答案、截图数量和请求状态', async () => {
    mockLoadConnectionSettings.mockResolvedValue({
      serverUrl: 'wss://sync.example.com',
      pairingCode: MOBILE_PAIRING_CODE
    })
    mockUseSyncConnection.mockReturnValue({
      connectionState: { status: 'connected' },
      sessionState: {
        ...initialSessionState,
        sessionId: 'session-1',
        lastSeq: 8,
        solution: '# 动态规划\n\n使用状态转移。',
        screenshotTotal: 3,
        requestStatus: 'completed'
      },
      scrollCommand: null,
      reconnect: jest.fn()
    })

    await render(<App />)

    await waitFor(() => {
      expect(screen.getByText('已连接')).toBeOnTheScreen()
    })
    expect(screen.getByText('动态规划')).toBeOnTheScreen()
    expect(screen.getByText('使用状态转移。')).toBeOnTheScreen()
    expect(screen.getByText('3')).toBeOnTheScreen()
    expect(screen.getByText('已完成')).toBeOnTheScreen()
  })

  it('保存连接设置后使用安全存储内容建立连接', async () => {
    const reconnect = jest.fn()
    mockUseSyncConnection.mockReturnValue({
      connectionState: { status: 'disconnected' },
      sessionState: initialSessionState,
      scrollCommand: null,
      reconnect
    })
    await render(<App />)
    await waitFor(() => expect(screen.getByText('未连接')).toBeOnTheScreen())

    await fireEvent.changeText(screen.getByLabelText('服务器地址'), ' ws://10.0.2.2:8787 ')
    await fireEvent.changeText(screen.getByLabelText('配对码'), ` ${MOBILE_PAIRING_CODE} `)
    await fireEvent.press(screen.getByRole('button', { name: '保存并连接' }))

    await waitFor(() => {
      expect(mockSaveConnectionSettings).toHaveBeenCalledWith({
        serverUrl: 'ws://10.0.2.2:8787',
        pairingCode: MOBILE_PAIRING_CODE
      })
    })
    expect(mockUseSyncConnection).toHaveBeenLastCalledWith({
      serverUrl: 'ws://10.0.2.2:8787',
      pairingCode: MOBILE_PAIRING_CODE
    })
    expect(reconnect).toHaveBeenCalledTimes(1)
  })

  it('扫描电脑端二维码后保存配对信息并连接', async () => {
    const reconnect = jest.fn()
    mockUseSyncConnection.mockReturnValue({
      connectionState: { status: 'disconnected' },
      sessionState: initialSessionState,
      scrollCommand: null,
      reconnect
    })
    await render(<App />)
    await waitFor(() => expect(screen.getByText('未连接')).toBeOnTheScreen())

    await fireEvent.press(screen.getByRole('button', { name: '扫描电脑端二维码' }))
    const payload = createPairingPayload({
      serverUrl: 'ws://127.0.0.1:8787',
      pairingCode: MOBILE_PAIRING_CODE
    })
    expect(payload).not.toBeNull()

    await fireEvent(screen.getByLabelText('二维码扫描相机'), 'barcodeScanned', { data: payload })

    await waitFor(() => {
      expect(mockSaveConnectionSettings).toHaveBeenCalledWith({
        serverUrl: 'ws://127.0.0.1:8787',
        pairingCode: MOBILE_PAIRING_CODE
      })
    })
    expect(mockUseSyncConnection).toHaveBeenLastCalledWith({
      serverUrl: 'ws://127.0.0.1:8787',
      pairingCode: MOBILE_PAIRING_CODE
    })
    expect(reconnect).toHaveBeenCalledTimes(1)
  })

  it('收到远端翻页命令后按当前视口比例滚动', async () => {
    mockLoadConnectionSettings.mockResolvedValue({
      serverUrl: 'ws://127.0.0.1:8787',
      pairingCode: MOBILE_PAIRING_CODE
    })
    const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation()
    const connectionResult = {
      connectionState: { status: 'connected' } as const,
      sessionState: {
        ...initialSessionState,
        solution: '足够长的答案',
        sessionId: 'session-1',
        requestStatus: 'loading'
      } as SessionState,
      scrollCommand: null as {
        commandId: string
        direction: 'up' | 'down'
        distanceRatio?: number
      } | null,
      reconnect: jest.fn()
    }
    mockUseSyncConnection.mockImplementation(() => connectionResult)

    const rendered = await render(<App />)
    await waitFor(() => expect(screen.getByText('已连接')).toBeOnTheScreen())
    const workspace = screen.getByTestId('workspace-scroll')
    await fireEvent(workspace, 'layout', {
      nativeEvent: { layout: { height: 600 } }
    })
    await fireEvent(workspace, 'contentSizeChange', 0, 1_800)

    connectionResult.scrollCommand = {
      commandId: 'command-1',
      direction: 'down'
    }
    await rendered.rerender(<App />)

    expect(scrollTo).toHaveBeenCalledWith({ y: 450, animated: false })

    connectionResult.scrollCommand = {
      commandId: 'command-2',
      direction: 'down',
      distanceRatio: 0.1
    }
    await rendered.rerender(<App />)

    expect(scrollTo).toHaveBeenLastCalledWith({ y: 510, animated: false })

    connectionResult.sessionState = {
      ...connectionResult.sessionState,
      requestStatus: 'completed'
    }
    connectionResult.scrollCommand = {
      commandId: 'command-3',
      direction: 'up'
    }
    await rendered.rerender(<App />)

    expect(scrollTo).toHaveBeenLastCalledWith({ y: 60, animated: true })
    scrollTo.mockRestore()
  })
})
