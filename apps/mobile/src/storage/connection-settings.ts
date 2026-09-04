import * as SecureStore from 'expo-secure-store'

const CONNECTION_SETTINGS_KEY = 'sync.connectionSettings'

export type ConnectionSettings = {
  serverUrl: string
  pairingCode: string
}

export async function loadConnectionSettings(): Promise<ConnectionSettings | null> {
  const stored = await SecureStore.getItemAsync(CONNECTION_SETTINGS_KEY)
  if (!stored) return null
  const parsed: unknown = JSON.parse(stored)
  if (!parsed || typeof parsed !== 'object') return null
  const { serverUrl, pairingCode } = parsed as Record<string, unknown>
  if (typeof serverUrl !== 'string' || typeof pairingCode !== 'string') return null
  return { serverUrl, pairingCode }
}

export async function saveConnectionSettings(settings: ConnectionSettings): Promise<void> {
  const serverUrl = settings.serverUrl.trim()
  const pairingCode = settings.pairingCode.trim()

  await SecureStore.setItemAsync(
    CONNECTION_SETTINGS_KEY,
    JSON.stringify({ serverUrl, pairingCode })
  )
}
