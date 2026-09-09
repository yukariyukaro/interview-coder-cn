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
  scrollInputController: {
    next: vi.fn(() => 0.75),
    reset: vi.fn()
  },
  takeNewScreenshot: vi.fn(),
  appendScreenshot: vi.fn(),
  stopSolutionStream: vi.fn(() => true),
  sendFollowUpQuestion: vi.fn(),
  state: { inCoderPage: true, ignoreMouse: false },
  settings: {
    apiKey: 'key',
    silentMode: false,
    activeSceneId: 'coding',
    customPrompt: 'coding prompt',
    scenes: [
      {
        id: 'coding',
        name: '解算法题',
        prompt: 'coding prompt',
        model: '',
        reasoningEffort: 'default',
        shortcut: 'Alt+Enter',
        isPreset: true
      },
      {
        id: 'aptitude-test',
        name: '能力测评',
        prompt: 'choice prompt',
        model: 'gpt-5-mini',
        reasoningEffort: 'low',
        shortcut: 'Alt+P',
        isPreset: true
      }
    ]
  }
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
vi.mock('../windows/silent-mode', () => ({
  concealMainWindow: vi.fn(),
  isMainWindowSoftHidden: vi.fn(() => false),
  isSilentModeEnabled: mocks.isSilentModeEnabled,
  revealMainWindow: vi.fn(() => true),
  transitionSilentMode: mocks.transitionSilentMode
}))
vi.mock('../windows/toolbar-window', () => ({
  showToolbar: vi.fn(),
  hideToolbar: vi.fn(),
  setToolbarWanted: mocks.setToolbarWanted,
  reassertToolbarTopMost: vi.fn()
}))
vi.mock('../core/state', () => ({ state: mocks.state }))
vi.mock('../core/settings', () => ({ settings: mocks.settings }))
vi.mock('../sync/mobile-sync', () => ({
  sendMobileScrollCommand: mocks.sendMobileScrollCommand
}))
vi.mock('./scroll-input', () => ({
  createScrollInputController: vi.fn(() => mocks.scrollInputController)
}))
vi.mock('../solution/solution-controller', () => ({
  takeNewScreenshot: mocks.takeNewScreenshot,
  appendScreenshot: mocks.appendScreenshot,
  stopSolutionStream: mocks.stopSolutionStream,
  sendFollowUpQuestion: mocks.sendFollowUpQuestion
}))
vi.mock('./transcription', () => ({
  getTranscriptionText: vi.fn(() => ''),
  clearTranscriptionText: vi.fn()
}))
vi.mock('../core/ipc-sender', () => ({
  isMainWindowSender: mocks.isMainWindowSender,
  isTrustedWindowSender: mocks.isTrustedWindowSender
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
    mocks.scrollInputController.next.mockReset().mockReturnValue(0.75)
    mocks.takeNewScreenshot.mockClear()
    mocks.appendScreenshot.mockClear()
    mocks.stopSolutionStream.mockClear().mockReturnValue(true)
    mocks.sendFollowUpQuestion.mockClear()
    mocks.state.inCoderPage = true
    mocks.settings.silentMode = false
    mocks.settings.activeSceneId = 'coding'
    mocks.settings.customPrompt = 'coding prompt'
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

    expect(mainWindow.webContents.send).toHaveBeenCalledWith(channel, 0.75)
    expect(mocks.sendMobileScrollCommand).toHaveBeenCalledWith(direction, 0.75)
  })

  it.each([
    ['pageLeft', 'scroll-page-left'],
    ['pageRight', 'scroll-page-right']
  ] as const)('scrolls only the desktop for %s', (action, channel) => {
    const triggerAction = mocks.handlers.get('triggerAction')
    const mainWindow = createMainWindowMock()
    global.mainWindow = mainWindow as never
    mocks.isTrustedWindowSender.mockReturnValue(true)

    expect(triggerAction!({ sender: {} }, action)).toBe(true)

    expect(mainWindow.webContents.send).toHaveBeenCalledWith(channel, 0.75)
    expect(mocks.sendMobileScrollCommand).not.toHaveBeenCalled()
  })

  it('passes continuous distance for repeated page-left shortcuts', () => {
    const triggerAction = mocks.handlers.get('triggerAction')
    const mainWindow = createMainWindowMock()
    global.mainWindow = mainWindow as never
    mocks.isTrustedWindowSender.mockReturnValue(true)
    mocks.scrollInputController.next.mockReturnValueOnce(0.75).mockReturnValueOnce(0.1)

    expect(triggerAction!({ sender: {} }, 'pageLeft')).toBe(true)
    expect(triggerAction!({ sender: {} }, 'pageLeft')).toBe(true)

    expect(mainWindow.webContents.send).toHaveBeenNthCalledWith(1, 'scroll-page-left', 0.75)
    expect(mainWindow.webContents.send).toHaveBeenNthCalledWith(2, 'scroll-page-left', 0.1)
    expect(mocks.sendMobileScrollCommand).not.toHaveBeenCalled()
  })

  it('passes continuous distance for repeated page-down shortcuts', () => {
    const triggerAction = mocks.handlers.get('triggerAction')
    const mainWindow = createMainWindowMock()
    global.mainWindow = mainWindow as never
    mocks.isTrustedWindowSender.mockReturnValue(true)
    mocks.scrollInputController.next.mockReturnValueOnce(0.75).mockReturnValueOnce(0.1)

    expect(triggerAction!({ sender: {} }, 'pageDown')).toBe(true)
    expect(triggerAction!({ sender: {} }, 'pageDown')).toBe(true)

    expect(mainWindow.webContents.send).toHaveBeenNthCalledWith(1, 'scroll-page-down', 0.75)
    expect(mainWindow.webContents.send).toHaveBeenNthCalledWith(2, 'scroll-page-down', 0.1)
    expect(mocks.sendMobileScrollCommand).toHaveBeenNthCalledWith(1, 'down', 0.75)
    expect(mocks.sendMobileScrollCommand).toHaveBeenNthCalledWith(2, 'down', 0.1)
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

  it('selects a synchronized scene before invoking its capture shortcut', () => {
    const initShortcuts = mocks.handlers.get('initShortcuts')
    const mainWindow = createMainWindowMock()
    global.mainWindow = mainWindow as never
    mocks.isMainWindowSender.mockReturnValue(true)

    initShortcuts!(
      { sender: {} },
      {
        'captureScene:aptitude-test': {
          action: 'captureScene:aptitude-test',
          key: 'Alt+P'
        }
      }
    )
    mocks.registeredCallbacks.get('Alt+P')!()

    expect(mocks.settings.activeSceneId).toBe('aptitude-test')
    expect(mocks.settings.customPrompt).toBe('choice prompt')
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      'active-scene-changed',
      'aptitude-test'
    )
    expect(mocks.takeNewScreenshot).toHaveBeenCalledOnce()
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
