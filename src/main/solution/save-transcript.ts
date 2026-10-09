import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AudioSource, TranscriptionSegment } from '../input/transcription'
import { SOURCE_LABELS } from '../input/transcription'
import { formatLocalSaveTimestamp, getLocalSaveDir } from './local-save'

export function createTranscriptFilename(date = new Date()): string {
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0')
  return `transcript_${formatLocalSaveTimestamp(date)}_${milliseconds}.md`
}

function formatClock(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** One archived utterance, e.g. `- [15:30:01] 面试官 说说你的项目` */
export function formatTranscriptLine(source: AudioSource, segment: TranscriptionSegment): string {
  return `- [${formatClock(segment.at)}] ${SOURCE_LABELS[source]} ${segment.text.trim()}`
}

/** Separates the conversation rounds that share one session transcript file */
export function formatTranscriptSection(at: number): string {
  return `### ${formatClock(at)}`
}

export function formatTranscriptDocument(lines: string[]): string {
  return ['# 面试转录', '', ...lines, ''].join('\n')
}

/**
 * One file per app session, holding every conversation round as a section. It is
 * rewritten on every finalized utterance instead of being written once at the end,
 * so a crash or a kill cannot lose what was already spoken.
 */
export async function saveTranscriptToDisk(content: string, filename: string): Promise<void> {
  if (!content.trim()) return

  try {
    const dir = getLocalSaveDir()
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, filename), content, 'utf8')
  } catch (error) {
    console.error('Failed to save transcript:', error)
  }
}
