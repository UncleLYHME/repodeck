import { defineConfig } from '@playwright/test'

// End-to-end tests drive the built app (pnpm build) under Xvfb: `pnpm e2e`.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 8_000 },
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
})
