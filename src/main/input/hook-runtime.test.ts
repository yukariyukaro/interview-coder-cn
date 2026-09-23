import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeHookApi } from './native-addon.d'

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  onChannelChanged: vi.fn(),
  bindings: [] as Array<{ action: string; key: string }>,
  sent: vi.fn()
}))

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() }
}))

import { setNativeHookForTesting } from './native-addon'
import {
  compileHookBinding,
  configureHookRuntime,
  disposeHookRuntime,
  getHookStatus,
  initHookRuntime,
  isHookUsable,
  refreshHookBindings,
  resolveNativeKey,
  setHookSuspended
} from './hook-runtime'

type AddonMock = NativeHookApi & {
  install: ReturnType<typeof vi.fn>
  updateBindings: ReturnType<typeof vi.fn>
  uninstall: ReturnType<typeof vi.fn>
  getHealth: ReturnType<typeof vi.fn>
}

function createAddon(options: { installResult?: boolean } = {}): AddonMock {
  return {
    install: vi.fn(() => options.installResult ?? true),
    updateBindings: vi.fn(),
    uninstall: vi.fn(),
    isInstalled: vi.fn(() => true),
    getHealth: vi.fn(() => ({ hookSilentMs: 0, systemIdleMs: 0 })),
    setTriggerHandler: vi.fn()
  } as unknown as AddonMock
}

beforeEach(() => {
  vi.useRealTimers()
  mocks.bindings = []
  mocks.dispatch.mockClear()
  mocks.onChannelChanged.mockClear()
  mocks.sent.mockClear()
  // Test double for the main window used by status broadcasts
  ;(global as unknown as { mainWindow: unknown }).mainWindow = {
    isDestroyed: () => false,
    webContents: { send: mocks.sent }
  }
  configureHookRuntime({
    dispatch: mocks.dispatch,
    getBindings: () => mocks.bindings,
    onChannelChanged: mocks.onChannelChanged
  })
})

describe('compileHookBinding', () => {
  it('compiles a right-modifier binding into keycodes', () => {
    const binding = compileHookBinding('hideOrShowMainWindow', 'RightControl+H', 'win32')
    expect(binding).toEqual({
      id: 'hideOrShowMainWindow',
      prefixVk: 0xa3,
      finalVk: 0x48,
      shift: false,
      ctrl: false,
      alt: false,
      meta: false
    })
  })

  it('carries the extra modifiers and named keys', () => {
    expect(compileHookBinding('appendScreenshot', 'RightControl+Shift+Enter', 'win32')).toEqual({
      id: 'appendScreenshot',
      prefixVk: 0xa3,
      finalVk: 0x0d,
      shift: true,
      ctrl: false,
      alt: false,
      meta: false
    })
    expect(compileHookBinding('pageUp', 'RightControl+Up', 'win32')?.finalVk).toBe(0x26)
  })

  it('rejects anything that is not a hook binding', () => {
    expect(compileHookBinding('pageUp', 'CommandOrControl+J', 'win32')).toBeNull()
    expect(compileHookBinding('pageUp', 'RightControl', 'win32')).toBeNull()
  })

  it('has a keycode for every key the recorder can produce', () => {
    const recordable = [
      ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
      ...'0123456789'.split(''),
      ...Array.from({ length: 12 }, (_unused, index) => `F${index + 1}`),
      'Up',
      'Down',
      'Left',
      'Right',
      'Enter',
      'Tab',
      'Space',
      'Backspace',
      'Escape',
      '`',
      '-',
      '=',
      '\\',
      '[',
      ']',
      ';',
      "'",
      ',',
      '.',
      '/'
    ]
    for (const key of recordable) {
      for (const platform of ['win32', 'darwin'] as const) {
        expect(resolveNativeKey(key, platform), `${key} on ${platform}`).not.toBeNull()
      }
    }
  })

  it('knows which prefixes exist on which platform', () => {
    expect(resolveNativeKey('RightControl', 'win32')).toBe(0xa3)
    expect(resolveNativeKey('RightAlt', 'win32')).toBe(0xa5)
    expect(resolveNativeKey('RightControl', 'darwin')).toBe(62)
    expect(resolveNativeKey('RightCommand', 'darwin')).toBe(0x36)
    // Windows has no right Command; the recorder never produces that token there
    expect(resolveNativeKey('RightCommand', 'win32')).toBeNull()
  })
})

describe('install lifecycle', () => {
  it('stays idle while no binding needs the hook', () => {
    const addon = createAddon()
    setNativeHookForTesting(addon)
    initHookRuntime()

    mocks.bindings = [{ action: 'pageUp', key: 'CommandOrControl+J' }]
    const plan = refreshHookBindings()

    expect(plan.bindings).toEqual([])
    expect(isHookUsable()).toBe(false)
    expect(addon.install).not.toHaveBeenCalled()
    expect(getHookStatus().reason).toBe('unused')
    expect(addon.uninstall).not.toHaveBeenCalled()
  })

  it('installs and pushes bindings as soon as a right-modifier binding appears', () => {
    const addon = createAddon()
    setNativeHookForTesting(addon)
    initHookRuntime()

    mocks.bindings = [
      { action: 'hideOrShowMainWindow', key: 'RightControl+H' },
      { action: 'pageUp', key: 'CommandOrControl+J' }
    ]
    const plan = refreshHookBindings()

    expect(addon.install).toHaveBeenCalledTimes(1)
    expect(addon.updateBindings).toHaveBeenCalledWith({
      bindings: [compileHookBinding('hideOrShowMainWindow', 'RightControl+H')]
    })
    expect(plan.hooked.has('hideOrShowMainWindow')).toBe(true)
    expect(plan.hooked.has('pageUp')).toBe(false)
    expect(isHookUsable()).toBe(true)
    expect(getHookStatus()).toMatchObject({ available: true, reason: 'ok', hookedCount: 1 })

    // Dropping the hook binding tears the hook back down
    mocks.bindings = [{ action: 'pageUp', key: 'CommandOrControl+J' }]
    refreshHookBindings()
    expect(addon.uninstall).toHaveBeenCalled()
    expect(isHookUsable()).toBe(false)
  })

  it('degrades when the addon cannot install', () => {
    const addon = createAddon({ installResult: false })
    setNativeHookForTesting(addon)
    initHookRuntime()

    mocks.bindings = [{ action: 'hideOrShowMainWindow', key: 'RightControl+H' }]
    const plan = refreshHookBindings()

    expect(isHookUsable()).toBe(false)
    expect(getHookStatus()).toMatchObject({ available: false, hookedCount: 0 })
    // The binding is still listed as a hook binding; the registrar degrades it because
    // isHookUsable() is false
    expect(plan.hooked.has('hideOrShowMainWindow')).toBe(true)
  })

  it('reports a missing addon', () => {
    setNativeHookForTesting(null)
    initHookRuntime()
    mocks.bindings = [{ action: 'hideOrShowMainWindow', key: 'RightControl+H' }]
    refreshHookBindings()

    expect(getHookStatus()).toMatchObject({ available: false, reason: 'no-addon' })
  })

  it('uninstalls on dispose and re-installs from scratch', () => {
    const addon = createAddon()
    setNativeHookForTesting(addon)
    initHookRuntime()
    mocks.bindings = [{ action: 'hideOrShowMainWindow', key: 'RightControl+H' }]
    refreshHookBindings()

    disposeHookRuntime()
    expect(addon.uninstall).toHaveBeenCalledTimes(1)
    expect(isHookUsable()).toBe(false)
  })
})

describe('suspend while recording', () => {
  it('stands down, stays down, and comes back', () => {
    const addon = createAddon()
    setNativeHookForTesting(addon)
    initHookRuntime()
    mocks.bindings = [{ action: 'hideOrShowMainWindow', key: 'RightControl+H' }]
    refreshHookBindings()
    expect(isHookUsable()).toBe(true)

    setHookSuspended(true)
    expect(addon.uninstall).toHaveBeenCalled()
    expect(isHookUsable()).toBe(false)

    // A registration that happens mid-recording must not bring the hook back up,
    // otherwise it would swallow the very key the recorder is waiting for
    const plan = refreshHookBindings()
    expect(plan.hooked.size).toBe(0)
    expect(addon.install).toHaveBeenCalledTimes(1)

    setHookSuspended(false)
    expect(addon.install).toHaveBeenCalledTimes(2)
    expect(isHookUsable()).toBe(true)
    expect(mocks.onChannelChanged).toHaveBeenCalled()

    disposeHookRuntime()
  })
})

describe('health check', () => {
  it.runIf(process.platform === 'win32')(
    'reinstalls a hook that the system silently dropped',
    async () => {
      vi.useFakeTimers()
      const addon = createAddon()
      addon.getHealth.mockReturnValue({ hookSilentMs: 6000, systemIdleMs: 1000 })
      setNativeHookForTesting(addon)
      initHookRuntime()
      mocks.bindings = [{ action: 'hideOrShowMainWindow', key: 'RightControl+H' }]
      refreshHookBindings()
      expect(addon.install).toHaveBeenCalledTimes(1)

      // The system saw input, our hook did not -> the hook was dropped
      await vi.advanceTimersByTimeAsync(3100)

      expect(addon.uninstall).toHaveBeenCalled()
      expect(addon.install).toHaveBeenCalledTimes(2)
      expect(mocks.onChannelChanged).toHaveBeenCalled()
      disposeHookRuntime()
      vi.useRealTimers()
    }
  )

  it.runIf(process.platform === 'win32')('keeps a healthy hook installed', async () => {
    vi.useFakeTimers()
    const addon = createAddon()
    addon.getHealth.mockReturnValue({ hookSilentMs: 1200, systemIdleMs: 1200 })
    setNativeHookForTesting(addon)
    initHookRuntime()
    mocks.bindings = [{ action: 'hideOrShowMainWindow', key: 'RightControl+H' }]
    refreshHookBindings()

    await vi.advanceTimersByTimeAsync(3100)

    expect(addon.install).toHaveBeenCalledTimes(1)
    expect(addon.uninstall).not.toHaveBeenCalled()
    disposeHookRuntime()
    vi.useRealTimers()
  })
})
