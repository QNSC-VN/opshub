import { test } from '@playwright/test';
import { expect, gotoInShell, settle } from './support/fixtures';

/**
 * Workforce leave, end to end through the real UI: file a request → it appears in the list →
 * the reason survives a reload.
 *
 * A SURFACE JOURNEY, NOT A SMOKE CHECK. `shell.e2e.ts` already proves `/workforce` renders. This
 * walks the flow that screen exists for, because rendering and working are different claims: the
 * form posts to `POST /v1/workforce/leave`, which lands in the generic request engine, writes an
 * audit entry and schedules a notification. A page that renders while the mutation 400s looks
 * identical in a screenshot.
 *
 * WHY THE UI AND NOT THE API SUITE. `test/e2e/request-visibility.e2e.spec.ts` already covers the
 * authorization; what only a browser can catch is the wiring — a field the form never sends, a
 * date format the DTO rejects, a list that does not re-fetch after the write. Every one of those
 * is invisible to a test that calls the service directly.
 *
 * The reload assertion is the point of the last step: it distinguishes "React put the row in
 * local state" from "the server has it".
 */
/**
 * A leave window no earlier run has used.
 *
 * `hasOverlappingLeave` refuses a second request across the same dates with a 409, so FIXED dates
 * make this spec pass exactly once and then fail against its own leftovers — which it did, and the
 * failure read as "the row was never persisted" while the row from the previous run sat in the
 * table. The database is shared with the API suites and is not reset between Playwright runs, so
 * uniqueness has to come from the test.
 *
 * Derived from the clock in whole days, so two runs collide only inside the same second.
 */
function uniqueLeaveWindow(): { start: string; end: string } {
  const day = 86_400_000;
  // Base far in the future so nothing here can collide with seeded or hand-made data.
  const base = Date.UTC(2030, 0, 1);
  const startMs = base + (Math.floor(Date.now() / 1000) % 3000) * day;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { start: iso(startMs), end: iso(startMs + day) };
}

test.describe('workforce leave', () => {
  test('files a leave request and it appears in the list', async ({ page }) => {
    // A unique reason is the handle for finding this row later. `Date.now()` rather than a fixed
    // string because these specs run against a database other tests also write to.
    const reason = `Playwright leave ${Date.now()}`;

    await gotoInShell(page, '/workforce');

    // The page opens on the Timesheets tab, whose action is "Log timesheet" — the leave form only
    // exists once Leave is selected. Worth stating: the first version of this spec waited 45s for
    // a "Request leave" button on the wrong tab, which reads like a missing feature rather than a
    // missing click.
    await page.getByRole('button', { name: 'Leave', exact: true }).click();

    await page.getByRole('button', { name: /request leave/i }).click();

    // Located by ROLE and PLACEHOLDER, not by walking divs. This overlay is a bare `<div>` —
    // 11 of the SPA's 12 modals hand-roll one instead of using `shared/ui/modal.tsx`, the only
    // component that sets `role="dialog"`, so `getByRole('dialog')` finds nothing. That is a real
    // accessibility defect (a screen reader never announces these as dialogs) and it is recorded
    // in `fe-consistency.ratchet.test.ts` rather than worked around silently. When those modals
    // move onto the shared component, scope this to `page.getByRole('dialog')`.
    await expect(page.getByRole('heading', { name: 'Request leave' })).toBeVisible();

    await page.getByRole('combobox').selectOption('annual');
    // `input[type=date]` surfaces as a textbox in the accessibility tree, so the type selector is
    // the honest way to reach the two date fields.
    const dates = page.locator('input[type="date"]');
    const { start, end } = uniqueLeaveWindow();
    await dates.nth(0).fill(start);
    await dates.nth(1).fill(end);
    await page.getByPlaceholder(/optional reason/i).fill(reason);

    await page.getByRole('button', { name: 'Request', exact: true }).click();

    // The list re-fetches after the mutation; wait for the row rather than a fixed delay.
    await expect(page.getByText(reason).first()).toBeVisible({ timeout: 15_000 });

    // Reload: proves the row is on the SERVER, not just in React state.
    await page.reload({ waitUntil: 'domcontentloaded' });
    // The active tab is component state, not URL state, so a reload lands back on Timesheets and
    // the leave list is not even mounted. Without this the assertion below fails with "vanished on
    // reload", which reads exactly like a persistence bug — it cost one debugging round to find
    // that the row was fine and the tab was wrong.
    await page.getByRole('button', { name: 'Leave', exact: true }).click();
    await settle(page);
    await expect(
      page.getByText(reason).first(),
      'the leave request vanished on reload — it was never persisted',
    ).toBeVisible({ timeout: 15_000 });
  });
});
