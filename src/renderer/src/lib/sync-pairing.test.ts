import { describe, expect, it } from 'vitest'

import { deriveMobilePairingCode } from './sync-pairing'

describe('deriveMobilePairingCode', () => {
  it('derives a stable role-scoped mobile credential', async () => {
    await expect(deriveMobilePairingCode('0123456789abcdef0123456789abcdef')).resolves.toBe(
      '69c56adc3602a8564f055aad589f18b9ba0b50ce8058eed0a95f491a541e92bf'
    )
  })

  it('does not derive a credential from an invalid desktop secret', async () => {
    await expect(deriveMobilePairingCode('short')).resolves.toBe('')
  })
})
