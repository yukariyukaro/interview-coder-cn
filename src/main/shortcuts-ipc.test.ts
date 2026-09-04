import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  registeredCallbacks: new Map<string, () => void>(),
  isMainWindowSender: vi.fn(() => false),
  isTrustedWindowSender: vi.fn(() => false),
  isSilentModeEnabled: vi.fn(() => false),
  transitionSilentMode: vi.fn(),
  setToolbarWanted: vi.fn(),
  sendMobileScrollCommand: vi.fn(),
  state: { inCoderPage: true, ignoreMouse: false },
  settings: { apiKey: 'key', silentMode: false }
}))

vi.mock('electron', () => ({
  globalShortcut: {
    register: vi.fn((key: string, callback: () => void) => {
      mocks.registeredCallbacks.set(key, callback)
      return true
    }),
    unregister: vi.fn()
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    })
  }
}))
vi.mock('./silent-mode', () => ({
  concealMainWindow: vi.fn(),
  isMainWindowSoftHidden: vi.fn(() => false),
  isSilentModeEnabled: mocks.isSilentModeEnabled,
  revealMainWindow: vi.fn(() => true),
  transitionSilentMode: mocks.transitionSilentMode
}))
vi.mock('./toolbar-window', () => ({
  showToolbar: vi.fn(),
  hideToolbar: vi.fn(),
  setToolbarWanted: mocks.setToolbarWanted,
  reassertToolbarTopMost: vi.fn()
}))
vi.mock('./take-screenshot', () => ({ takeScreenshot: vi.fn() }))
vi.mock('./save-screenshot', () => ({ saveScreenshotToDisk: vi.fn() }))
vi.mock('./ai', () => ({
  getSolutionStream: vi.fn(),
  getFollowUpStream: vi.fn(),
  getGeneralStream: vi.fn()
}))
vi.mock('./state', () => ({ state: mocks.state }))
vi.mock('./settings', () => ({ settings: mocks.settings }))
vi.mock('./mobile-sync', () => ({
  sendMobileScrollCommand: mocks.sendMobileScrollCommand
}))
vi.mock('./transcription', () => ({
  getTranscriptionText: vi.fn(() => ''),
  clearTranscriptionText: vi.fn()
}))
vi.mock('./ipc-sender', () => ({
  isMainWindowSender: mocks.isMainWindowSender,
  isTrustedWindowSender: mocks.isTrustedWindowSender
}))
vi.mock('./solution-events', () => ({
  solutionEventPublisher: {
    resetSession: vi.fn(),
    publish: vi.fn()
  }
}))

await import('./shortcuts')

function createMainWindowMock() {
  return {
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => false),
    setAlwaysOnTop: vi.fn(),
    moveTop: vi.fn(),
    webContents: {
      send: vi.fn()
    }
  }
}

describe('shortcuts IPC sender protection', () => {
  beforeEach(() => {
    mocks.registeredCallbacks.clear()
    mocks.isMainWindowSender.mockReturnValue(false)
    mocks.isTrustedWindowSender.mockReturnValue(false)
    mocks.isSilentModeEnabled.mockReturnValue(false)
    mocks.transitionSilentMode.mockClear()
    mocks.setToolbarWanted.mockClear()
    mocks.sendMobileScrollCommand.mockClear()
    mocks.state.inCoderPage = true
    mocks.settings.silentMode = false
    global.mainWindow = undefined
  })

  it.each(['getShortcuts', 'stopSolutionStream'])(
    'rejects main-window-only channel %s from an untrusted renderer',
    (channel) => {
      const handler = mocks.handlers.get(channel)
      expect(handler).toBeTypeOf('function')

      expect(handler!({ sender: {} })).toBe(false)
    }
  )

  it('rejects a follow-up request from an untrusted renderer', async () => {
    const handler = mocks.handlers.get('sendFollowUpQuestion')
    expect(handler).toBeTypeOf('function')

    await expect(handler!({ sender: {} }, 'question')).resolves.toEqual({
      success: false,
      error: 'Unauthorized'
    })
  })

  it('allows toolbar actions only from an application-owned renderer', () => {
    const triggerAction = mocks.handlers.get('triggerAction')
    const setToolbarVisible = mocks.handlers.get('setToolbarVisible')
    expect(triggerAction).toBeTypeOf('function')
    expect(setToolbarVisible).toBeTypeOf('function')

    expect(triggerAction!({ sender: {} }, 'pageUp')).toBe(false)
    expect(setToolbarVisible!({ sender: {} }, true)).toBe(false)
    expect(mocks.setToolbarWanted).not.toHaveBeenCalled()

    mocks.isTrustedWindowSender.mockReturnValue(true)
    expect(triggerAction!({ sender: {} }, 'unknownAction')).toBe(false)
    expect(setToolbarVisible!({ sender: {} }, true)).toBe(true)
    expect(mocks.setToolbarWanted).toHaveBeenCalledWith(true)
  })

  it.each([
    ['pageUp', 'scroll-page-up', 'up'],
    ['pageDown', 'scroll-page-down', 'down']
  ] as const)('scrolls the desktop and mobile for %s', (action, channel, direction) => {
    const triggerAction = mocks.handlers.get('triggerAction')
    const mainWindow = createMainWindowMock()
    global.mainWindow = mainWindow as never
    mocks.isTrustedWindowSender.mockReturnValue(true)

    expect(triggerAction!({ sender: {} }, action)).toBe(true)

    expect(mainWindow.webContents.send).toHaveBeenCalledWith(channel)
    expect(mocks.sendMobileScrollCommand).toHaveBeenCalledWith(direction)
  })

  it('does not scroll either target outside the coder page', () => {
    const triggerAction = mocks.handlers.get('triggerAction')
    const mainWindow = createMainWindowMock()
    global.mainWindow = mainWindow as never
    mocks.isTrustedWindowSender.mockReturnValue(true)
    mocks.state.inCoderPage = false

    expect(triggerAction!({ sender: {} }, 'pageDown')).toBe(true)

    expect(mainWindow.webContents.send).not.toHaveBeenCalledWith('scroll-page-down')
    expect(mocks.sendMobileScrollCommand).not.toHaveBeenCalled()
  })

  it('toggles silent mode from its dedicated global shortcut', () => {
    const initShortcuts = mocks.handlers.get('initShortcuts')
    const mainWindow = createMainWindowMock()
    global.mainWindow = mainWindow as never
    mocks.isMainWindowSender.mockReturnValue(true)

    expect(
      initShortcuts!(
        { sender: {} },
        {
          toggleSilentMode: {
            action: 'toggleSilentMode',
            key: 'Alt+Shift+H'
          }
        }
      )
    ).toBe(true)

    mocks.registeredCallbacks.get('Alt+Shift+H')!()

    expect(mocks.settings.silentMode).toBe(true)
    expect(mocks.transitionSilentMode).toHaveBeenCalledWith(
      mainWindow,
      true,
      expect.objectContaining({ ignoreMouseEvents: false })
    )
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('silent-mode-changed', true)
  })

  it('exits silent mode through the existing hide/show shortcut', () => {
    const initShortcuts = mocks.handlers.get('initShortcuts')
    const mainWindow = createMainWindowMock()
    global.mainWindow = mainWindow as never
    mocks.isMainWindowSender.mockReturnValue(true)
    mocks.isSilentModeEnabled.mockReturnValue(true)
    mocks.settings.silentMode = true

    initShortcuts!(
      { sender: {} },
      {
        hideOrShowMainWindow: {
          action: 'hideOrShowMainWindow',
          key: 'Alt+H'
        }
      }
    )
    mocks.registeredCallbacks.get('Alt+H')!()

    expect(mocks.settings.silentMode).toBe(false)
    expect(mocks.transitionSilentMode).toHaveBeenCalledWith(
      mainWindow,
      false,
      expect.objectContaining({ ignoreMouseEvents: false })
    )
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('silent-mode-changed', false)
  })
})
