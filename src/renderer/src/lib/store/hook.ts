import { create } from 'zustand'

export type HookStatusReason =
  | 'ok'
  /** Addon available, but no binding currently uses a right-side modifier */
  | 'unused'
  | 'no-addon'
  | 'failed'
  | 'permission-denied'
  | 'unsupported-platform'

export type HookStatus = {
  /** The native hook is installed and currently swallowing the right-modifier bindings */
  available: boolean
  reason: HookStatusReason
  /** Number of bindings currently served by the hook */
  hookedCount?: number
}

interface HookStatusStore extends HookStatus {
  setStatus: (status: HookStatus) => void
}

const initialStatus: HookStatus = {
  available: false,
  // Neutral until the real status arrives, so the settings banner never flashes a
  // scary "addon missing" message on the first paint
  reason: 'unused',
  hookedCount: 0
}

/**
 * Mirrors the main process hook status. Not persisted: main probes the native hook
 * on every launch, so a stale value would misreport which channel is active.
 */
export const useHookStatusStore = create<HookStatusStore>()((set) => ({
  ...initialStatus,
  setStatus: (status) => set(status)
}))
