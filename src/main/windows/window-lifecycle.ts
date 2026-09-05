import type { BrowserWindow } from 'electron'
import { revealMainWindow } from './silent-mode'

export function handleWindowReadyToShow(window: BrowserWindow): void {
  revealMainWindow(window)
}

export function handleAppActivate(
  windowCount: number,
  mainWindow: BrowserWindow | undefined,
  createWindow: () => void
): void {
  if (windowCount === 0) {
    createWindow()
    return
  }

  if (mainWindow && !mainWindow.isVisible()) {
    revealMainWindow(mainWindow)
  }
}
