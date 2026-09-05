import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  screen: {
    getAllDisplays: vi.fn(() => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }])
  }
}))

import { setSilentModeEnabled } from './silent-mode'
import { handleAppActivate, handleWindowReadyToShow } from './window-lifecycle'

function createWindowMock(initiallyVisible = false) {
  let visible = initiallyVisible

  return {
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => visible),
    setAlwaysOnTop: vi.fn(),
    setContentProtection: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    show: vi.fn(() => {
      visible = true
    }),
    showInactive: vi.fn(() => {
      visible = true
    })
  }
}

describe('window lifecycle guards', () => {
  beforeEach(() => {
    setSilentModeEnabled(false)
  })

  it('keeps the ready window hidden while silent mode is enabled', () => {
    const mainWindow = createWindowMock()
    setSilentModeEnabled(true)

    handleWindowReadyToShow(mainWindow as unknown as BrowserWindow)

    expect(mainWindow.show).not.toHaveBeenCalled()
    expect(mainWindow.showInactive).not.toHaveBeenCalled()
  })

  it('keeps an existing window hidden on activate while silent mode is enabled', () => {
    const mainWindow = createWindowMock()
    const createWindow = vi.fn()
    setSilentModeEnabled(true)

    handleAppActivate(1, mainWindow as unknown as BrowserWindow, createWindow)

    expect(createWindow).not.toHaveBeenCalled()
    expect(mainWindow.show).not.toHaveBeenCalled()
    expect(mainWindow.showInactive).not.toHaveBeenCalled()
  })

  it('creates a new window on activate when none exist', () => {
    const createWindow = vi.fn()

    handleAppActivate(0, undefined, createWindow)

    expect(createWindow).toHaveBeenCalledOnce()
  })
})
