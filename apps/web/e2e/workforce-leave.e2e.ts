import { test } from '@playwright/test';
import { expectRowSomewhere, expect, gotoInShell, settle } from './support/fixtures';

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
 * NOT `Date.now() % 3000`, which is what this did: that is 3000 SECONDS, so the window repeated every
 * fifty minutes and a later run collided with an earlier run's request for a 409 `LEAVE_OVERLAPPING`.
 *
 * A random offset inside 2030–2039 instead. The range matters: the API suite grants entitlements from
 * 2040 up, and a window landing in one of those hits a real balance earlier runs have partly consumed.
 *
 * ALWAYS LANDS ON A MONDAY. The API now refuses a window containing no working days
 * (`LEAVE_NO_WORKING_DAYS`): a Saturday-to-Sunday request costs nothing and is almost certainly a
 * mistyped date range. An arbitrary offset hits a weekend two days in seven, so this spec would
 * have failed about a third of its runs with a message about dates rather than about anything it
 * tests. Monday to Tuesday is two working days in every week of the year.
 */
function uniqueLeaveWindow(): { start: string; end: string } {
  const day = 86_400_000;
  // Base far in the future so nothing here can collide with seeded or hand-made data.
  const base = Date.UTC(2030, 0, 1);
  const startMs = base + Math.floor(Math.random() * 3600) * day;
  // Advance to the next Monday. getUTCDay: 0 = Sunday, 1 = Monday.
  const mondayMs = startMs + ((8 - new Date(startMs).getUTCDay()) % 7) * day;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { start: iso(mondayMs), end: iso(mondayMs + day) };
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
    //
    // `role: 'tab'` now, not `'button'`: the tab bar is a real `tablist`. This spec had to change for
    // that, which is the evidence the semantics improved rather than the markup merely moving.
    await page.getByRole('tab', { name: 'Leave', exact: true }).click();

    await page.getByRole('button', { name: /request leave/i }).click();

    // SCOPED TO THE DIALOG, which the comment this replaces said to do "when those modals move onto
    // the shared component". They have: the form is on `shared/ui/modal.tsx`, so it is announced as
    // a dialog, traps focus and closes on Escape. `getByRole('dialog')` finding it is the same signal
    // assistive technology now gets, and scoping the field lookups to it means a stray date input
    // elsewhere on the page cannot be filled by mistake.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Request leave' })).toBeVisible();

    await dialog.getByRole('combobox').selectOption('annual');
    // `input[type=date]` surfaces as a textbox in the accessibility tree, so the type selector is
    // the honest way to reach the two date fields.
    const dates = dialog.locator('input[type="date"]');
    const { start, end } = uniqueLeaveWindow();
    await dates.nth(0).fill(start);
    await dates.nth(1).fill(end);
    await dialog.getByPlaceholder(/optional reason/i).fill(reason);

    await dialog.getByRole('button', { name: 'Request', exact: true }).click();

    // Closing the dialog is part of the flow: a form that submits and stays open reads as a failure.
    await expect(dialog).toBeHidden();

    // The list re-fetches after the mutation; find the row rather than waiting a fixed delay.
    await expectRowSomewhere(page, reason);

    // Reload: proves the row is on the SERVER, not just in React state.
    await page.reload({ waitUntil: 'domcontentloaded' });
    // The active tab is component state, not URL state, so a reload lands back on Timesheets and
    // the leave list is not even mounted. Without this the assertion below fails with "vanished on
    // reload", which reads exactly like a persistence bug — it cost one debugging round to find
    // that the row was fine and the tab was wrong.
    await page.getByRole('tab', { name: 'Leave', exact: true }).click();
    await settle(page);
    await expectRowSomewhere(page, reason);
  });
});
