import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { app } from 'electron'

import type { NativeHookApi } from './native-addon.d'

const nodeRequire = createRequire(__filename)

/**
 * Candidate locations of the built addon.
 *
 * In development it sits in the repo's `resources/native`. Once packaged, the project
 * `resources/**` tree is listed in `asarUnpack`, so it ends up next to the archive;
 * `extraResources` layouts (a plain `resources/native`) are also accepted.
 */
function candidatePaths(): string[] {
  const fileName = `input-hook-${process.platform}-${process.arch}.node`
  if (!app.isPackaged) return [join(app.getAppPath(), 'resources', 'native', fileName)]
  return [
    join(process.resourcesPath, 'native', fileName),
    join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'native', fileName)
  ]
}

function resolveModulePath(): string {
  const candidates = candidatePaths()
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
}

let cached: NativeHookApi | null | undefined

/**
 * Loads the optional native hook addon. Returns null when the binary is absent or
 * fails to load, which is the normal case on a machine without a C++ toolchain.
 */
export function loadNativeHook(): NativeHookApi | null {
  if (cached !== undefined) return cached
  try {
    const loaded = nodeRequire(resolveModulePath()) as NativeHookApi
    cached = loaded && typeof loaded.install === 'function' ? loaded : null
  } catch {
    cached = null
  }
  return cached
}

/** Test seam: inject a fake addon (or null) without touching the filesystem */
export function setNativeHookForTesting(api: NativeHookApi | null): void {
  cached = api
}
