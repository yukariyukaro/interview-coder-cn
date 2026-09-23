/**
 * Shape of the optional native low-level hook addon.
 *
 * The binary lives in `resources/native/input-hook-<platform>-<arch>.node` and is
 * built by `npm run build:native`. It is intentionally optional: when it is missing
 * (no toolchain, unsupported arch) every binding degrades to Electron's
 * globalShortcut and the app behaves exactly as it did before the hook existed.
 */

export type NativeBinding = {
  id: string
  /** Sacrificial prefix keycode, e.g. right Ctrl */
  prefixVk: number
  /** The final key of the binding */
  finalVk: number
  shift: boolean
  ctrl: boolean
  alt: boolean
  meta: boolean
}

export type NativeHookConfig = {
  bindings: NativeBinding[]
}

export type NativeHookHealth = {
  /** ms since the hook last saw any key event */
  hookSilentMs: number
  /** ms since the system last saw any input at all */
  systemIdleMs: number
}

export type NativeHookApi = {
  install(config: NativeHookConfig): boolean
  updateBindings(config: NativeHookConfig): void
  uninstall(): void
  isInstalled(): boolean
  getHealth(): NativeHookHealth
  /** Called with a binding id when its key sequence completes */
  setTriggerHandler(handler: ((id: string) => void) | null): void
}
