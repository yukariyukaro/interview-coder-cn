import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { settings } from '../core/settings'
import { formatLocalSaveTimestamp, getLocalSaveDir } from './local-save'

export function createAnswerFilename(date = new Date()): string {
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0')
  return `answer_${formatLocalSaveTimestamp(date)}_${milliseconds}.md`
}

export async function saveAnswerToDisk(answer: string, filename: string): Promise<void> {
  if (!settings.answerAutoSave || !answer.trim()) return

  const dir = getLocalSaveDir()
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, filename), answer, 'utf8')
  } catch (error) {
    console.error('Failed to save AI answer:', error)
  }
}
