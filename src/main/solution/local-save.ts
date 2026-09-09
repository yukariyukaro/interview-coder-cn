import { app } from 'electron'
import { join } from 'node:path'
import { settings } from '../core/settings'

export function getLocalSaveDir(): string {
  return settings.screenshotDir || join(app.getPath('pictures'), 'InterviewCoder')
}

export function formatLocalSaveTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const datePart = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const timePart = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `${datePart}_${timePart}`
}
