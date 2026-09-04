import { describe, expect, it } from 'vitest'

import { shouldBootstrapMainRenderer } from './renderer-bootstrap'

describe('shouldBootstrapMainRenderer', () => {
  it.each(['#/toolbar', '#toolbar', '#/toolbar/'])(
    'does not bootstrap the toolbar renderer for hash %s',
    (hash) => {
      expect(shouldBootstrapMainRenderer(hash)).toBe(false)
    }
  )

  it.each(['', '#/', '#/settings', '#/help'])(
    'bootstraps a main-window route for hash %s',
    (hash) => {
      expect(shouldBootstrapMainRenderer(hash)).toBe(true)
    }
  )
})
