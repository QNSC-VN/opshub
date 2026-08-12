import { readdirSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { AUTH_STATE, AUTH_STATES } from './e2e/support/fixtures';

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
 * SHARED LOGINS, FOUR OF THEM, unlike rally, which logs in per test. rally has to: its bearer flow
 * rotates the refresh token on every use and revokes the family on reuse, so a shared session trips
 * that protection. OpsHub's SPA holds no tokens at all — auth is an opaque `__Host-opshub_session`
 * cookie backed by Valkey, and nothing rotates it — so `global-setup.ts` signs in once PER SEAT and
 * the spec files are spread across those seats.
 *
 * Four rather than one because the DEFAULT rate-limit tier is keyed on the user id: fifty specs as a
 * single principal exceeds 200 requests a minute and the next request comes back 429. That is also why
 * the logins go through the BFF route, which sidesteps the AUTH_LOGIN tier rally needs a
 * `DISABLE_RATE_LIMIT` flag for.
 */
/**
 * SPEC FILES, SPREAD ACROSS THE SEATS ROUND-ROBIN.
 *
 * Read from disk and sorted, so the assignment is deterministic and nobody maintains a list. The previous
 * version WAS a hand-written list of "heavy" files, and it put two heavy ones on the same seat and hit the
 * limiter again — the lesson being that a balance somebody has to remember is not a balance.
 */
const SPEC_FILES = readdirSync('./e2e')
  .filter((file) => file.endsWith('.e2e.ts'))
  .sort();

const seatFor = (seat: number): string[] =>
  SPEC_FILES.filter((_, index) => index % AUTH_STATES.length === seat).map((file) => `**/${file}`);

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
  projects: AUTH_STATES.map((state, seat) => ({
    name: seat === 0 ? 'chromium' : `chromium-seat-${seat + 1}`,
    testMatch: seatFor(seat),
    use: { ...devices['Desktop Chrome'], storageState: state },
  })),
  webServer: {
    command: 'pnpm dev --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
