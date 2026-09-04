import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['apps/mobile/**', '**/node_modules/**', '**/dist/**', '**/out/**']
  }
})
