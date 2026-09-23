// Builds the optional native hook addon into resources/native/.
//
// The build intentionally never fails the surrounding npm script: a machine without a
// C++ toolchain (or an unsupported arch) simply ships without the addon, and the app
// degrades every right-modifier binding back to the equivalent left-side accelerator.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const projectDir = join(root, 'native', 'input-hook')
const outputDir = join(root, 'resources', 'native')
const artifactName = `input-hook-${process.platform}-${process.arch}.node`

function skip(message) {
  console.warn(`[build-native] ${message}`)
  console.warn('[build-native] 跳过原生插件构建，应用会回退为系统快捷键。')
  process.exit(0)
}

if (!['win32', 'darwin'].includes(process.platform)) {
  skip(`不支持的平台 ${process.platform}`)
}

let nodeGyp
try {
  nodeGyp = require.resolve('node-gyp/bin/node-gyp.js')
} catch {
  skip('未找到 node-gyp，请先执行 npm install')
}

const build = spawnSync(process.execPath, [nodeGyp, 'rebuild'], {
  cwd: projectDir,
  stdio: 'inherit'
})

const builtArtifact = join(projectDir, 'build', 'Release', 'input-hook.node')
if (build.status !== 0 || !existsSync(builtArtifact)) {
  skip('原生插件编译失败（通常是缺少 C++ 工具链）')
}

mkdirSync(outputDir, { recursive: true })
copyFileSync(builtArtifact, join(outputDir, artifactName))
rmSync(join(projectDir, 'build'), { recursive: true, force: true })
console.log(`[build-native] ${artifactName} 已生成`)
