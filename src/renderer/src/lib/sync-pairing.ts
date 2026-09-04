import { MOBILE_PAIRING_CODE_DERIVATION_CONTEXT } from '@interview-coder/sync-protocol'

const DESKTOP_SECRET_PATTERN = /^[A-Za-z0-9_-]{32,64}$/

export async function deriveMobilePairingCode(desktopSecret: string): Promise<string> {
  const normalizedSecret = desktopSecret.trim()
  if (!DESKTOP_SECRET_PATTERN.test(normalizedSecret)) return ''

  const input = new TextEncoder().encode(
    `${MOBILE_PAIRING_CODE_DERIVATION_CONTEXT}${normalizedSecret}`
  )
  const digest = await crypto.subtle.digest('SHA-256', input)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}
