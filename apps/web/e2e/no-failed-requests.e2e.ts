import { test } from './support/test';
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
 *
 * ONE TEST PER ROUTE, following `shell.e2e.ts`. A single test looping all thirty is the tempting shape and it
 * does not fit: the suite's per-test budget is 45s and thirty navigations take minutes, so it fails on the
 * clock rather than on a finding. Nothing is lost by splitting — `gotoInShell` is a real `page.goto`, so the
 * shell's boot cost is paid per route either way, every failing route still appears in one report, and CI's
 * single retry now re-runs the one route that flaked instead of all thirty.
 */
test.describe('every screen loads its own data', () => {
  for (const route of SHELL_ROUTES) {
    test(`${route} renders with no failed API request`, async ({ page }) => {
      const failures: string[] = [];

      page.on('response', (response) => {
        const url = response.url();
        if (!url.includes('/v1/') || response.status() < 400) return;
        /*
         * The notification stream is excluded and nothing else is. It is a long-lived SSE connection that
         * the navigation aborts on the way out, which surfaces as a non-2xx through no fault of the screen.
         */
        if (url.includes('/notifications/stream')) return;
        failures.push(`${response.status()} ${url.split('/v1/')[1].split('?')[0]}`);
      });

      await gotoInShell(page, route);
      // A fixed settle rather than `networkidle`: the SSE stream means the network is never idle, so any
      // wait for it burns the full timeout — see `settle` in the fixtures.
      await settle(page);

      /*
       * EVERY FAILURE ON THE SCREEN, not the first. "Six panels on one screen" and "one endpoint across six
       * screens" are different bugs wanting different fixes, and only the full list distinguishes them.
       */
      expect([...new Set(failures)], `failed API requests on ${route}`).toEqual([]);
    });
  }
});
