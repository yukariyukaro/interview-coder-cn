import type { Platform } from '@interview-coder/shortcut-tokens'

export const isMac = navigator.userAgent.includes('Mac')

/** Alt on macOS, CommandOrControl (i.e. Ctrl) on Windows */
export const platformAlt = isMac ? 'Alt' : 'CommandOrControl'

/** Platform key used when translating hook accelerators to system accelerators */
export const platform: Platform = isMac ? 'darwin' : 'win32'
