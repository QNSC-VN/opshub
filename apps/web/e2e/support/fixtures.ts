import { expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Where global-setup writes the signed-in session for every spec to reuse.
 *
 * Relative to `apps/web`, which is Playwright's cwd, and imported by `playwright.config.ts` so
 * the path has exactly one definition — a config and a setup that each spelled it out would
 * drift into "storageState not found" the first time either moved.
 */
export const AUTH_STATE = 'e2e/.auth/state.json';

/**
 * A 429 IN A FULL RUN IS THE SUITE, NOT THE PRODUCT.
 *
 * Every spec signs in as the same seeded admin, and each page load fires a dozen API calls, so a whole
 * run makes well over the DEFAULT tier's 200 requests per minute for that one user. The refusal then
 * lands on whichever request happens to be next — measured once as a 429 on a certificate presign, which
 * reads like a broken upload. Re-run the spec on its own before believing it; the upload paths carry the
 * stricter UPLOAD tier (30/min) and a handful of uploads per run stays comfortably inside it.
 *
 * Not worked around by skipping the limiter: it is a protective control, and a test environment that
 * disables it stops testing the thing that runs in production. Spreading the specs across seeded
 * identities is the real fix when this starts costing time.
 */

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

/**
 * The CSRF token the API requires on every mutation.
 *
 * The saved storage state carries the SESSION cookie only, so a bare `request.post` comes back
 * `FORBIDDEN: Missing csrf secret` — which reads like an authorization bug in the route rather than a
 * missing header in the test. `GET /v1/auth/me` is where the SPA itself gets the token.
 */
export async function csrfHeaders(request: APIRequestContext): Promise<Record<string, string>> {
  const me = await request.get('/v1/auth/me');
  expect(me.ok(), await me.text()).toBe(true);
  const { csrfToken } = (await me.json()) as { csrfToken?: string };
  expect(csrfToken, 'GET /auth/me did not return a CSRF token').toBeTruthy();
  return { 'X-CSRF-Token': csrfToken! };
}

/**
 * Act as somebody ELSE for one API call, without disturbing the browser session.
 *
 * Some flows can only be advanced by a different person: a performance review moves to the reviewer
 * only when its SUBJECT submits a self-assessment, and the API keys that on the caller's own id. Driving
 * it in the browser would mean a second signed-in context and a logout, for a step the spec is not
 * testing.
 *
 * A BEARER TOKEN, not a session cookie: `/v1/auth/dev-login` returns one, the API accepts it, and it
 * carries no cookie so it cannot interfere with the storage state every other call in the spec uses.
 * Non-production only, exactly like the BFF dev-login the global setup uses.
 */
export async function actingAs(
  request: APIRequestContext,
  email: string,
): Promise<Record<string, string>> {
  // CSRF applies here too: the request context carries the saved SESSION cookie, so the API treats this
  // as a browser call and the hook demands the header — a bearer login is still a mutation.
  const res = await request.post('/v1/auth/dev-login', {
    headers: await csrfHeaders(request),
    data: { email },
  });
  expect(res.ok(), `dev-login failed for ${email}: ${await res.text()}`).toBe(true);
  const body = (await res.json()) as { accessToken?: string; data?: { accessToken?: string } };
  const token = body.accessToken ?? body.data?.accessToken;
  expect(token, `dev-login returned no access token for ${email}`).toBeTruthy();
  return { authorization: `Bearer ${token}` };
}

/**
 * Put one real item in the request engine, and return its id.
 *
 * Specs that assert on the inbox need a request to exist. A FRESH database has none — CI's does not,
 * mine did, and that difference is what failed this spec in CI while it passed locally for the third
 * time in this migration. Create what you assert on.
 */
export async function createAccessRequest(request: APIRequestContext): Promise<string> {
  const res = await request.post('/v1/access-requests', {
    headers: await csrfHeaders(request),
    data: {
      accessType: 'vpn',
      target: `playwright-${Date.now()}`,
      justification: 'Created by an e2e spec so the inbox has something to show.',
      durationHours: 8,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { data?: { id: string }; id?: string };
  return body.data?.id ?? body.id!;
}

/**
 * Find a row anywhere in the paged list, walking the pager.
 *
 * Lists page at 25 and order by a DOMAIN date rather than by creation — leave by `start_date DESC`,
 * contracts by their own order — so a row a spec just created is not necessarily on page 1 once a few
 * runs have accumulated. Asserting only the first page makes a spec pass or fail on how its random
 * fixture data happens to sort, which is a property of the data and not of the feature.
 *
 * Walking also proves the pager works, which is new on every screen this migration touched.
 *
 * SETTLES BEFORE IT LOOKS, on every page. Called straight after a filter change, the loop otherwise
 * reads the PREVIOUS result set: the row is missing because its page has not arrived yet, and the
 * pager still belongs to the old query — so the loop can page forward off the row it is looking for
 * and then report "not on any page" about a row sitting on page 1. Measured: the contracts journey
 * failed three runs out of three that way, with the row present in both the API and the DOM.
 */
export async function expectRowSomewhere(page: Page, text: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 15_000 });
    if (
      await page
        .getByText(text)
        .first()
        .isVisible()
        .catch(() => false)
    )
      return;
    const next = page.getByRole('button', { name: /Next/ });
    if (!(await next.isVisible().catch(() => false)) || (await next.isDisabled())) break;
    await next.click();
  }
  // 15s, the same budget as every other "wait for a list to arrive" in this harness. 5s was enough
  // locally and not in CI, where a reload plus a tab click plus a fetch shared one budget — the leave
  // spec failed on it once and passed on retry, which is the signature of a timeout rather than a
  // missing row.
  await expect(
    page.getByText(text).first(),
    `"${text}" was not on any page of the list`,
  ).toBeVisible({ timeout: 15_000 });
}

/**
 * Move a list's status filter, and wait until it has actually moved.
 *
 * Every list screen filters by status through the same `SegmentedControl`, so the locator belongs here
 * once. The `aria-checked` wait is not decoration: it is the cheapest proof that React has committed
 * the state change, and therefore that the table is showing the new query's loading row rather than
 * the previous filter's rows. Without it a following assertion can read the OLD result set.
 */
export async function selectStatusFilter(page: Page, label: string): Promise<void> {
  const radio = page
    .getByRole('radiogroup', { name: /status/i })
    .getByRole('radio', { name: label });
  await radio.click();
  await expect(radio).toHaveAttribute('aria-checked', 'true');
}

/**
 * Click the first DATA row of a `DataTable`, once there is one.
 *
 * `tbody tr` also matches the table's own state rows — the loading placeholder, the error row, the empty
 * state — and those are single `colSpan` cells with no click handler. Clicking one does nothing, so a
 * spec that raced the fetch failed with "no dialog appeared", which reads like a broken drawer rather
 * than a test that clicked too early. Measured: it failed roughly one run in three.
 *
 * Waits for the loading row to go and for a row with more than one cell, which is what a data row is.
 */
export async function clickFirstRow(page: Page): Promise<void> {
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 15_000 });
  const dataRow = page
    .locator('tbody tr')
    .filter({ has: page.locator('td:nth-child(2)') })
    .first();
  await expect(dataRow).toBeVisible({ timeout: 15_000 });
  await dataRow.click();
}

export { expect };
