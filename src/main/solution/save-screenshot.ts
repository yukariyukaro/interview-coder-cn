import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { settings } from '../core/settings'
import { formatLocalSaveTimestamp, getLocalSaveDir } from './local-save'

export async function saveScreenshotToDisk(base64Data: string): Promise<void> {
  if (!settings.screenshotAutoSave) return

  const dir = getLocalSaveDir()
  try {
    await mkdir(dir, { recursive: true })
    const filePath = join(dir, `${formatLocalSaveTimestamp()}.png`)
    const buffer = Buffer.from(base64Data, 'base64')
    await writeFile(filePath, buffer)
  } catch (error) {
    console.error('Failed to save screenshot:', error)
  }
}
