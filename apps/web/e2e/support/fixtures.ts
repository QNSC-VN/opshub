import { expect, type Page } from '@playwright/test';

/**
 * Where global-setup writes the signed-in session for every spec to reuse.
 *
 * Relative to `apps/web`, which is Playwright's cwd, and imported by `playwright.config.ts` so
 * the path has exactly one definition — a config and a setup that each spelled it out would
 * drift into "storageState not found" the first time either moved.
 */
export const AUTH_STATE = 'e2e/.auth/state.json';

/**
 * Seeded principals, from `db/seed.ts` — one employee per system role.
 *
 * `ADMIN` holds the wildcard permission, so it is the tier that must see everything. `EMPLOYEE`
 * holds NO permission codes at all by design (self-service is expressed by scope, not by a
 * code), which makes it the tier every narrowing rule has to constrain.
 */
export const FIXTURE = {
  ADMIN: { email: 'admin@opshub.local' },
  EMPLOYEE: { email: 'employee@opshub.local' },
} as const;

/**
 * Give React Query a beat to settle.
 *
 * DOES NOT wait for `networkidle`. The SPA holds a Server-Sent Events notification stream open
 * (`GET /v1/notifications/stream`), so the network never goes idle and any wait for it burns the
 * full timeout before failing. Prefer an element assertion — Playwright auto-waits those — and
 * use this only where a list has to re-fetch after a write.
 */
export async function settle(page: Page, ms = 1500): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(ms);
}

/**
 * Open a route and wait for the authenticated shell, not a fixed delay.
 *
 * Asserting the shell is present is what distinguishes "the page rendered" from "the session
 * expired and we bounced to /login" — the second is otherwise a passing test against an empty
 * screen. The sidebar navigation only exists inside the shell.
 */
export async function gotoInShell(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('nav').first()).toBeVisible({ timeout: 20_000 });
  expect(
    new URL(page.url()).pathname,
    'bounced to the login page — the session did not load',
  ).not.toContain('login');
}

export { expect };
