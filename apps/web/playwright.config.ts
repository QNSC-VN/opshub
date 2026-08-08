import { defineConfig, devices } from '@playwright/test';
import { AUTH_STATE } from './e2e/support/fixtures';

/**
 * Playwright config for the OpsHub SPA.
 *
 * Assumes the API is on :3001 (`docker compose -f docker-compose.dev.yml up -d`,
 * `pnpm db:migrate`, `pnpm start:dev`) and the seed data is loaded. Playwright starts the Vite
 * dev server itself, which proxies `/v1` to the API.
 *
 * Run:  pnpm --filter opshub-web test:e2e
 *
 * SERIAL, ONE WORKER. These specs create real rows through the real API, and several assert on
 * "the thing I just made appears in this list". Parallel workers would interleave writes into
 * each other's lists, and the failure would look like a UI bug.
 *
 * ONE SHARED LOGIN, unlike rally, which logs in per test. rally has to: its bearer flow rotates
 * the refresh token on every use and revokes the family on reuse, so a shared session trips that
 * protection. OpsHub's SPA holds no tokens at all — auth is an opaque `__Host-opshub_session`
 * cookie backed by Valkey, and nothing rotates it — so `global-setup.ts` signs in once and every
 * spec reuses the storage state. That also sidesteps the AUTH_LOGIN rate limit rally needs a
 * `DISABLE_RATE_LIMIT` flag for.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:5173',
    // Written by global-setup: the session cookie, so every spec starts signed in.
    storageState: AUTH_STATE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
