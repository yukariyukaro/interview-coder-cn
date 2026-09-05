import { act, renderHook } from '@testing-library/react-native'

import { useSyncConnection } from '../sync/use-sync-connection'

const MOBILE_PAIRING_CODE = '69c56adc3602a8564f055aad589f18b9ba0b50ce8058eed0a95f491a541e92bf'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []

  readonly url: string
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  sent: string[] = []
  close = jest.fn()

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  open() {
    this.onopen?.()
  }

  receive(data: unknown) {
    this.onmessage?.({ data })
  }

  send(data: string) {
    this.sent.push(data)
  }

  disconnect() {
    this.onclose?.()
  }
}

describe('useSyncConnection', () => {
  const originalWebSocket = globalThis.WebSocket

  beforeEach(() => {
    jest.useFakeTimers()
    FakeWebSocket.instances = []
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    globalThis.WebSocket = originalWebSocket
  })

  it('配置缺失时不创建 WebSocket', async () => {
    const { result } = await renderHook(() => useSyncConnection(null))

    expect(result.current.connectionState).toEqual({ status: 'disconnected' })
    expect(FakeWebSocket.instances).toHaveLength(0)
  })

  it('开发构建允许局域网明文 WebSocket 地址', async () => {
    const { result } = await renderHook(() =>
      useSyncConnection({
        serverUrl: 'ws://192.168.1.10:8787',
        pairingCode: MOBILE_PAIRING_CODE
      })
    )

    expect(result.current.connectionState).toEqual({ status: 'connecting' })
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(FakeWebSocket.instances[0].url).toBe('ws://192.168.1.10:8787/?role=mobile')
  })

  it('拒绝将桌面密钥直接作为手机配对码', async () => {
    const { result } = await renderHook(() =>
      useSyncConnection({
        serverUrl: 'ws://127.0.0.1:8787',
        pairingCode: '0123456789abcdef0123456789abcdef'
      })
    )

    expect(result.current.connectionState).toEqual({
      status: 'error',
      kind: 'configuration',
      message: '手机配对码必须是 64 位小写十六进制字符'
    })
    expect(FakeWebSocket.instances).toHaveLength(0)
  })

  it('连接成功后进入已连接状态并携带移动端鉴权参数', async () => {
    const { result } = await renderHook(() =>
      useSyncConnection({
        serverUrl: 'ws://127.0.0.1:8787',
        pairingCode: MOBILE_PAIRING_CODE
      })
    )

    const socket = FakeWebSocket.instances[0]
    expect(socket.url).toBe('ws://127.0.0.1:8787/?role=mobile')

    await act(() => socket.open())
    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
      { type: 'authenticate', pairingCode: MOBILE_PAIRING_CODE }
    ])
    await act(() => socket.receive(JSON.stringify({ type: 'authenticated' })))

    expect(result.current.connectionState).toEqual({ status: 'connected' })
  })

  it('暴露滚动命令且不修改答案会话状态', async () => {
    const { result } = await renderHook(() =>
      useSyncConnection({
        serverUrl: 'ws://127.0.0.1:8787',
        pairingCode: MOBILE_PAIRING_CODE
      })
    )
    const socket = FakeWebSocket.instances[0]
    await act(() => socket.open())
    await act(() => socket.receive(JSON.stringify({ type: 'authenticated' })))
    const initialSession = result.current.sessionState

    await act(() =>
      socket.receive(
        JSON.stringify({
          version: 1,
          type: 'control.scroll',
          commandId: 'command-1',
          timestamp: 1_725_000_000_000,
          payload: { direction: 'down', distanceRatio: 0.75 }
        })
      )
    )

    expect(result.current.scrollCommand).toEqual({
      commandId: 'command-1',
      direction: 'down',
      distanceRatio: 0.75
    })
    expect(result.current.sessionState).toBe(initialSession)

    const firstCommand = result.current.scrollCommand
    await act(() =>
      socket.receive(
        JSON.stringify({
          version: 1,
          type: 'control.scroll',
          commandId: 'command-1',
          timestamp: 1_725_000_000_001,
          payload: { direction: 'up', distanceRatio: 0.1 }
        })
      )
    )
    expect(result.current.scrollCommand).toBe(firstCommand)

    await act(() =>
      socket.receive(
        JSON.stringify({
          version: 1,
          type: 'control.scroll',
          commandId: 'command-2',
          timestamp: 1_725_000_000_002,
          payload: { direction: 'up', distanceRatio: 0.1 }
        })
      )
    )
    expect(result.current.scrollCommand).toEqual({
      commandId: 'command-2',
      direction: 'up',
      distanceRatio: 0.1
    })
  })

  it('短连接反复断开时持续指数退避，稳定后才重置', async () => {
    await renderHook(() =>
      useSyncConnection({
        serverUrl: 'ws://127.0.0.1:8787',
        pairingCode: MOBILE_PAIRING_CODE
      })
    )

    await act(() => FakeWebSocket.instances[0].disconnect())
    await act(() => jest.advanceTimersByTime(999))
    expect(FakeWebSocket.instances).toHaveLength(1)

    await act(() => jest.advanceTimersByTime(1))
    expect(FakeWebSocket.instances).toHaveLength(2)

    await act(() => FakeWebSocket.instances[1].disconnect())
    await act(() => jest.advanceTimersByTime(1_999))
    expect(FakeWebSocket.instances).toHaveLength(2)

    await act(() => jest.advanceTimersByTime(1))
    expect(FakeWebSocket.instances).toHaveLength(3)

    await act(() => FakeWebSocket.instances[2].open())
    await act(() => FakeWebSocket.instances[2].disconnect())
    await act(() => jest.advanceTimersByTime(3_999))
    expect(FakeWebSocket.instances).toHaveLength(3)
    await act(() => jest.advanceTimersByTime(1))
    expect(FakeWebSocket.instances).toHaveLength(4)

    await act(() => FakeWebSocket.instances[3].open())
    await act(() => FakeWebSocket.instances[3].receive(JSON.stringify({ type: 'authenticated' })))
    await act(() => jest.advanceTimersByTime(10_000))
    await act(() => FakeWebSocket.instances[3].disconnect())
    await act(() => jest.advanceTimersByTime(999))
    expect(FakeWebSocket.instances).toHaveLength(4)
    await act(() => jest.advanceTimersByTime(1))
    expect(FakeWebSocket.instances).toHaveLength(5)
  })

  it('非法事件进入协议错误状态且不写入答案', async () => {
    const { result } = await renderHook(() =>
      useSyncConnection({
        serverUrl: 'ws://127.0.0.1:8787',
        pairingCode: MOBILE_PAIRING_CODE
      })
    )

    const socket = FakeWebSocket.instances[0]
    await act(() => socket.open())
    await act(() => socket.receive(JSON.stringify({ type: 'authenticated' })))
    await act(() => socket.receive(JSON.stringify({ type: 'solution.delta' })))

    expect(result.current.connectionState).toEqual({
      status: 'error',
      kind: 'protocol',
      message: '收到不符合协议的同步事件'
    })
    expect(result.current.sessionState.solution).toBe('')
    expect(result.current.sessionState.protocolError).toBe('收到不符合协议的同步事件')
    expect(socket.close).toHaveBeenCalledWith(1008, 'Protocol error')
  })
})
