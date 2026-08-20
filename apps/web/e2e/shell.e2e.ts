import { test } from './support/test';
import { expect, gotoInShell } from './support/fixtures';

/**
 * The authenticated shell renders and its navigation reaches every top-level surface.
 *
 * This is the one deliberately broad spec, and it exists because of what it would have caught:
 * the SPA holds no tokens, so a break anywhere in the cookie → `GET /v1/auth/me` → shell
 * hydration chain logs everyone out of everything, and the API-level suites cannot see it. Every
 * other spec here walks ONE surface in depth (per the sibling repo's rule that a per-page smoke
 * check is not a journey); this one proves the frame those journeys start from.
 *
 * Routes come from `app/router/router.tsx`. A 404 or an error boundary on any of them fails.
 */
const SURFACES = [
  { path: '/', heading: /dashboard|overview/i },
  { path: '/assets', heading: /assets/i },
  { path: '/people', heading: /people|employees/i },
  { path: '/workforce', heading: /workforce|timesheet|leave/i },
  { path: '/access', heading: /access/i },
  { path: '/compliance', heading: /compliance/i },
  { path: '/requests', heading: /requests/i },
  { path: '/catalog', heading: /catalog/i },
  { path: '/settings/audit-logs', heading: /audit/i },
] as const;

test.describe('authenticated shell', () => {
  test('signs in from the saved session and renders the shell', async ({ page }) => {
    await gotoInShell(page, '/');

    // The nav is the shell's load-bearing element: it renders only for an authenticated
    // principal, so its presence is the evidence the session hydrated rather than bounced.
    await expect(page.locator('nav').first()).toBeVisible();
  });

  for (const { path, heading } of SURFACES) {
    test(`reaches ${path} without an error boundary`, async ({ page }) => {
      await gotoInShell(page, path);

      // A heading proves the page's own component mounted — the shell alone would render for a
      // route that silently fell through to a blank outlet.
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({
        timeout: 15_000,
      });

      // An error boundary or a failed query renders these; a healthy screen never does.
      await expect(page.getByText(/something went wrong|unexpected error/i)).toHaveCount(0);
    });
  }
});

/**
 * The shell's own controls are visible when focused.
 *
 * WHY THIS IS A BROWSER TEST. jsdom computes no styles, so a unit test can only assert that a class
 * NAME is present — it cannot tell whether the class produces anything. Tailwind's `ring` compiles to a
 * `box-shadow`, so a real browser can be asked the one question that matters: after tabbing here, does
 * anything actually change on screen?
 *
 * WHAT IT WOULD HAVE CAUGHT. Twenty-nine of the thirty-two hand-rolled buttons in the SPA had a `hover:`
 * rule and no focus rule at all, including all five in this shell and all four in the notification bell.
 * A keyboard user tabbing across the top bar saw nothing move — and every existing test passed, because
 * every existing test clicks.
 */
test.describe('shell controls are keyboard-visible', () => {
  /*
   * ONLY CONTROLS THAT ALWAYS EXIST. My first version included `AI Assistant`, which is behind a feature
   * flag, and guarded it with a mid-test `test.skip()` — that reported as a failure with an empty error
   * in a full run rather than as a skip. A spec that has to reason about whether its subject is switched
   * on is a spec that reports on the flag instead of on the thing.
   */
  const CONTROLS = ['Notifications', 'Hide sidebar'];

  for (const name of CONTROLS) {
    test(`${name} shows a focus ring`, async ({ page }) => {
      await gotoInShell(page, '/');

      const control = page.getByRole('button', { name }).first();
      await control.focus();
      await expect(control).toBeFocused();

      const shadow = await control.evaluate((el) => getComputedStyle(el).boxShadow);
      // `none` is the exact value a button with no focus rule reports, which is what all nine of these
      // returned before they were moved onto the kit's Button.
      expect(shadow, `${name} shows nothing when focused`).not.toBe('none');
      expect(shadow).not.toBe('');
    });
  }
});
