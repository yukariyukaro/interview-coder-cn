import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  toolbarWindows: [] as Array<ReturnType<typeof createWindowMock>>
}))

vi.mock('electron', () => ({
  BrowserWindow: class {
    constructor() {
      const window = createWindowMock()
      electronMocks.toolbarWindows.push(window)
      return window
    }
  },
  screen: {
    getAllDisplays: vi.fn(() => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }]),
    getDisplayMatching: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 }
    }))
  }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false }
}))

import {
  applySilentMode,
  isSilentModeEnabled,
  revealMainWindow,
  setSilentModeEnabled,
  transitionSilentMode
} from './silent-mode'
import { createToolbarWindow, hideToolbar, setToolbarWanted, showToolbar } from './toolbar-window'

function createWindowMock(initiallyVisible = true) {
  let visible = initiallyVisible

  return {
    hide: vi.fn(() => {
      visible = false
    }),
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => visible),
    show: vi.fn(() => {
      visible = true
    }),
    showInactive: vi.fn(() => {
      visible = true
    }),
    setAlwaysOnTop: vi.fn(),
    setContentProtection: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    getPosition: vi.fn(() => [100, 100] as [number, number]),
    setPosition: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    setMenuBarVisibility: vi.fn(),
    setOpacity: vi.fn(),
    loadFile: vi.fn(),
    loadURL: vi.fn(),
    on: vi.fn(),
    getBounds: vi.fn(() => ({ x: 100, y: 100, width: 900, height: 670 })),
    setBounds: vi.fn(),
    close: vi.fn(),
    webContents: {
      send: vi.fn()
    }
  }
}

describe('silent mode', () => {
  beforeEach(() => {
    setSilentModeEnabled(false)
    setToolbarWanted(false)
    electronMocks.toolbarWindows.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps the main window hidden when silent mode is enabled before reveal', () => {
    const mainWindow = createWindowMock(false)

    setSilentModeEnabled(true)
    revealMainWindow(mainWindow as unknown as BrowserWindow)

    expect(isSilentModeEnabled()).toBe(true)
    expect(mainWindow.show).not.toHaveBeenCalled()
    expect(mainWindow.showInactive).not.toHaveBeenCalled()
  })

  it('hides a visible window only once when silent mode is applied repeatedly', () => {
    const mainWindow = createWindowMock()

    setSilentModeEnabled(true)
    applySilentMode(mainWindow as unknown as BrowserWindow)
    applySilentMode(mainWindow as unknown as BrowserWindow)

    expect(mainWindow.hide).toHaveBeenCalledOnce()
  })

  it('reveals the main window with capture protection and top-most behavior after leaving silent mode', () => {
    const mainWindow = createWindowMock(false)

    setSilentModeEnabled(true)
    setSilentModeEnabled(false)
    revealMainWindow(mainWindow as unknown as BrowserWindow)

    if (process.platform === 'darwin' || process.platform === 'win32') {
      expect(mainWindow.showInactive).toHaveBeenCalledOnce()
      expect(mainWindow.show).not.toHaveBeenCalled()
    } else {
      expect(mainWindow.show).toHaveBeenCalledOnce()
      expect(mainWindow.showInactive).not.toHaveBeenCalled()
    }
    expect(mainWindow.setContentProtection).toHaveBeenCalledWith(true)
    expect(mainWindow.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver', 1)
    expect(mainWindow.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true
    })
  })

  it('does not reveal the toolbar while silent mode is enabled', () => {
    const ownerWindow = createWindowMock()

    setSilentModeEnabled(true)
    createToolbarWindow(ownerWindow as unknown as BrowserWindow)
    setToolbarWanted(true)

    expect(electronMocks.toolbarWindows).toHaveLength(1)
    expect(electronMocks.toolbarWindows[0].showInactive).not.toHaveBeenCalled()
  })

  it('hides an already visible toolbar when entering silent mode', () => {
    const mainWindow = createWindowMock()

    createToolbarWindow(mainWindow as unknown as BrowserWindow)
    setToolbarWanted(true)
    const toolbarWindow = electronMocks.toolbarWindows[0]
    expect(toolbarWindow.showInactive).toHaveBeenCalledOnce()

    transitionSilentMode(mainWindow as unknown as BrowserWindow, true, {
      hideCompanionWindow: hideToolbar,
      showCompanionWindow: showToolbar
    })

    expect(toolbarWindow.hide).toHaveBeenCalledOnce()
  })

  it('soft-hides and restores the Windows window without native hide or show calls', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const mainWindow = createWindowMock()

    transitionSilentMode(mainWindow as unknown as BrowserWindow, true)

    expect(mainWindow.hide).not.toHaveBeenCalled()
    expect(mainWindow.setOpacity).toHaveBeenCalledWith(0)
    expect(mainWindow.setIgnoreMouseEvents).toHaveBeenCalledWith(true)
    expect(mainWindow.setPosition).toHaveBeenCalledWith(3920, 0)

    transitionSilentMode(mainWindow as unknown as BrowserWindow, false, {
      ignoreMouseEvents: true
    })

    expect(mainWindow.show).not.toHaveBeenCalled()
    expect(mainWindow.showInactive).not.toHaveBeenCalled()
    expect(mainWindow.setPosition).toHaveBeenLastCalledWith(100, 100)
    expect(mainWindow.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true)
    expect(mainWindow.setOpacity).toHaveBeenLastCalledWith(1)
    expect(mainWindow.setContentProtection).toHaveBeenCalledWith(false)
    expect(mainWindow.setContentProtection).toHaveBeenCalledWith(true)
  })
})
