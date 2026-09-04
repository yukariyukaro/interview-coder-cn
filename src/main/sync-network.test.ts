import { beforeEach, describe, expect, it, vi } from 'vitest'

const networkInterfaces = vi.hoisted(() => vi.fn())

vi.mock('node:os', () => ({ networkInterfaces }))

import { getMobileSyncServerUrl } from './sync-network'

describe('getMobileSyncServerUrl', () => {
  beforeEach(() => {
    networkInterfaces.mockReturnValue({
      en0: [{ address: '100.86.210.69', family: 'IPv4', internal: false }]
    })
  })

  it('replaces a loopback host with the LAN address for mobile pairing', () => {
    expect(getMobileSyncServerUrl('ws://127.0.0.1:8787')).toBe('ws://100.86.210.69:8787/')
  })

  it('keeps a remote sync service URL unchanged', () => {
    expect(getMobileSyncServerUrl('wss://sync.example.com/socket')).toBe(
      'wss://sync.example.com/socket'
    )
  })

  it('rejects an invalid sync service URL', () => {
    expect(getMobileSyncServerUrl('http://127.0.0.1:8787')).toBeNull()
  })
})
