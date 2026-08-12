import { defineConfig, devices } from '@playwright/test';
import { AUTH_STATE, AUTH_STATE_SECOND, AUTH_STATE_THIRD } from './e2e/support/fixtures';

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
/** The write-heavy specs, on the SECOND seat. */
const SECOND_SEAT_SPECS = [
  '**/performance.e2e.ts',
  '**/isms-risks.e2e.ts',
  '**/positions-contracts.e2e.ts',
];

/**
 * Training gets a seat of its own.
 *
 * It is the heaviest file in the suite — two real uploads, five async pickers, five tabs — and it was the
 * one that kept losing a picker search to a 429 in the second full run of the day while passing alone.
 * A third bucket is cheaper than making the limiter configurable.
 */
const THIRD_SEAT_SPECS = ['**/training.e2e.ts'];

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
  /**
   * THREE PROJECTS, THREE ADMIN SEATS, and it is a rate-limit decision rather than a coverage one.
   *
   * The DEFAULT tier allows 200 requests a minute PER USER. Every spec signed in as the same admin, each
   * page load costs roughly fifteen calls, and forty-odd specs run inside two minutes — so the suite
   * crossed the line and whichever request landed next came back 429. It surfaced twice, the first time
   * disguised as a broken upload.
   *
   * Splitting the spec FILES between two seeded admins halves each bucket. Both projects are the same
   * browser with the same permissions; only the identity differs, so nothing about what is covered
   * changes. The heavier, write-happy suites go on the second seat.
   *
   * Deliberately NOT solved by making the limit configurable: a control that tests can turn down is a
   * control that stops describing production. If the suite doubles again, seed a third seat.
   */
  projects: [
    {
      name: 'chromium',
      testIgnore: [...SECOND_SEAT_SPECS, ...THIRD_SEAT_SPECS],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-second-seat',
      testMatch: SECOND_SEAT_SPECS,
      use: { ...devices['Desktop Chrome'], storageState: AUTH_STATE_SECOND },
    },
    {
      name: 'chromium-third-seat',
      testMatch: THIRD_SEAT_SPECS,
      use: { ...devices['Desktop Chrome'], storageState: AUTH_STATE_THIRD },
    },
  ],
  webServer: {
    command: 'pnpm dev --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
