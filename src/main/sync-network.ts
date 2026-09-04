import { networkInterfaces } from 'node:os'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function getLanIPv4(): string | null {
  const interfaces = networkInterfaces()
  const preferredNames = ['en0', 'en1']

  for (const name of preferredNames) {
    const address = interfaces[name]?.find(
      (candidate) => candidate.family === 'IPv4' && !candidate.internal
    )
    if (address) return address.address
  }

  for (const addresses of Object.values(interfaces)) {
    const address = addresses?.find(
      (candidate) => candidate.family === 'IPv4' && !candidate.internal
    )
    if (address) return address.address
  }

  return null
}

export function getMobileSyncServerUrl(serverUrl: string): string | null {
  let url: URL
  try {
    url = new URL(serverUrl.trim())
  } catch {
    return null
  }

  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return null
  if (!LOOPBACK_HOSTS.has(url.hostname)) return url.toString()

  const lanAddress = getLanIPv4()
  if (!lanAddress) return null

  url.hostname = lanAddress
  return url.toString()
}
