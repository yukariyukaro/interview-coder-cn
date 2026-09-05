import { BrowserWindow, type WebContents } from 'electron'

export function isMainWindowSender(sender: WebContents): boolean {
  const mainWindow = global.mainWindow
  return Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents === sender)
}

export function isTrustedWindowSender(sender: WebContents): boolean {
  if (isMainWindowSender(sender)) return true
  const mainWindow = global.mainWindow
  if (!mainWindow || mainWindow.isDestroyed()) return false
  const senderWindow = BrowserWindow.fromWebContents(sender)
  return Boolean(senderWindow && senderWindow.getParentWindow() === mainWindow)
}
