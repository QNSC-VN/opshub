import { test } from '@playwright/test';
import { SHELL_ROUTES } from './support/routes';
import { expect, gotoInShell, settle } from './support/fixtures';

/**
 * No screen may render while its own data is failing.
 *
 * WHY THIS EXISTS. The reports dashboard shipped with SEVEN OF ITS NINE requests answering 422 —
 * `dateRange()` sent `YYYY-MM-DD` where every report parameter is `z.string().datetime({ offset: true })` —
 * so six panels displayed "Failed to load data" and the screen looked, to every test we had, entirely fine.
 * `shell.e2e.ts` asserts each route renders without an error BOUNDARY, and a page full of error messages
 * satisfies that perfectly.
 *
 * The gap was never "reports is untested". It was that nothing anywhere asked the one question a smoke test
 * should ask: did the screen's requests actually succeed. This asks it for all thirty routes.
 *
 * A SWEEP, NOT A JOURNEY. It clicks nothing and asserts no content — the per-screen specs do that. It only
 * watches the network, which is why it can afford to visit every route in the product.
 */
test.describe('every screen loads its own data', () => {
  // One test, not thirty: a fresh page per route would pay the shell's own boot cost thirty times, and the
  // rate limiter is keyed per user — thirty page loads is already most of a seat's budget for the minute.
  test('no route renders with a failed API request', async ({ page }) => {
    const broken: Record<string, string[]> = {};

    for (const route of SHELL_ROUTES) {
      const failures: string[] = [];
      const onResponse = (response: { url(): string; status(): number }) => {
        const url = response.url();
        if (!url.includes('/v1/') || response.status() < 400) return;
        /*
         * The notification stream is excluded and nothing else is. It is a long-lived SSE connection that
         * the navigation aborts on the way out, which surfaces as a non-2xx through no fault of the screen.
         */
        if (url.includes('/notifications/stream')) return;
        failures.push(`${response.status()} ${url.split('/v1/')[1].split('?')[0]}`);
      };

      page.on('response', onResponse);
      await gotoInShell(page, route);
      // A fixed settle rather than `networkidle`: the SSE stream means the network is never idle, so any
      // wait for it burns the full timeout — see `settle` in the fixtures.
      await settle(page);
      page.off('response', onResponse);

      const unique = [...new Set(failures)];
      if (unique.length) broken[route] = unique;
    }

    /*
     * REPORTED ALL AT ONCE. Failing on the first bad route would hide the rest, and "six panels on one
     * screen" versus "one endpoint across six screens" are different bugs that want different fixes — the
     * message has to distinguish them.
     */
    expect(
      broken,
      `routes rendering with failed API requests:\n${JSON.stringify(broken, null, 2)}`,
    ).toEqual({});
  });
});
