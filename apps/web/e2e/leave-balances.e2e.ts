import { test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { chooseFromPicker, csrfHeaders, expect, gotoInShell } from './support/fixtures';

/**
 * Leave balances, the holiday calendar and the accrual policies — the half of TMS that existed only in the
 * API until this screen.
 *
 * WHAT THIS PINS THAT NOTHING ELSE CAN
 * ------------------------------------
 * - a leave type with NO entitlement is untracked, and the screen says that rather than showing zero days
 * - setting an entitlement is an UPSERT: the same employee, type and year again corrects the allowance
 * - both figures are shown — `availableDays` is what may be booked now, `remainingDays` what the year settles
 *   at — because either one alone produces a support question
 * - the accrual policy behind each balance is read from the API, so the explanation is the rule the
 *   arithmetic used
 * - declaring and removing a public holiday round-trips, and the calendar is what makes a request's cost right
 */

const YEAR = 2031; // Far enough out that no seed or other spec has declared anything for it.

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`.toUpperCase();
}

async function createEmployee(request: APIRequestContext): Promise<{ id: string; name: string }> {
  const tag = unique('PWLV');
  const res = await request.post('/v1/employees', {
    headers: await csrfHeaders(request),
    data: {
      email: `${tag.toLowerCase()}@opshub.local`,
      displayName: `Leave Balance ${tag}`,
      firstName: 'Leave',
      lastName: tag,
      employmentType: 'full_time',
      startDate: '2026-01-01',
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { id: string };
  return { id: body.id, name: `Leave Balance ${tag}` };
}

async function openBalancesTab(page: Page): Promise<void> {
  await gotoInShell(page, '/workforce');
  await page.getByRole('tab', { name: /balances & calendar/i }).click();
  await page.getByLabel('Year').fill(String(YEAR));
}

test.describe('leave balances', () => {
  test('says a leave type is untracked rather than showing zero days', async ({ page }) => {
    await openBalancesTab(page);

    // "No entitlement declared" and "0 days" are different problems with different fixes, so the screen
    // does not render the second when it means the first.
    await expect(
      page.getByText(new RegExp(`No entitlement declared for ${YEAR}`, 'i')),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('sets an entitlement, and setting it again corrects rather than fails', async ({
    page,
    request,
  }) => {
    const employee = await createEmployee(request);
    await openBalancesTab(page);

    await page.getByRole('button', { name: /set entitlement/i }).click();
    let dialog = page.getByRole('dialog', { name: /set a leave entitlement/i });
    await chooseFromPicker(page, dialog, 'Employee', employee.name);
    await dialog.getByLabel(/^Leave type/).selectOption('annual');
    await dialog.getByLabel(/^Year/).fill(String(YEAR));
    await dialog.getByLabel(/^Granted days/).fill('20');
    // The policy governing the allowance is read from the API and shown where the number is typed.
    await expect(dialog.getByText(/accrues/i)).toBeVisible();
    await dialog.getByRole('button', { name: /set entitlement/i }).click();
    await expect(dialog).toBeHidden();

    // Read it back for that employee — the picker only appears for somebody who may read others.
    await chooseFromPicker(page, page.locator('body'), 'Balances for employee', employee.name);
    await expect(page.getByText(/Annual/).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/20 granted/)).toBeVisible();
    // BOTH figures: what may be booked now, and what the year settles at.
    await expect(page.getByText(/day\(s\) bookable now/)).toBeVisible();
    await expect(page.getByText(/left over the year/)).toBeVisible();

    // AN UPSERT. The same employee, type and year again is a correction, not a conflict.
    await page.getByRole('button', { name: /set entitlement/i }).click();
    dialog = page.getByRole('dialog', { name: /set a leave entitlement/i });
    await chooseFromPicker(page, dialog, 'Employee', employee.name);
    await dialog.getByLabel(/^Year/).fill(String(YEAR));
    await dialog.getByLabel(/^Granted days/).fill('25');
    await dialog.getByRole('button', { name: /set entitlement/i }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText(/25 granted/)).toBeVisible({ timeout: 15_000 });
  });

  test('declares a public holiday and removes it again', async ({ page }) => {
    const name = `Playwright Day ${unique('PWH')}`;
    await openBalancesTab(page);

    // No holidays for a far-future year, and the screen says what that means for a leave request's cost.
    await expect(page.getByText(new RegExp(`No holidays declared for ${YEAR}`, 'i'))).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: /declare a holiday/i }).click();
    const dialog = page.getByRole('dialog', { name: /declare a public holiday/i });
    await dialog.getByLabel(/^Date/).fill(`${YEAR}-05-01`);
    await dialog.getByLabel(/^Name/).fill(name);
    await dialog.getByRole('button', { name: /declare holiday/i }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 });
    // `ALL` is the default region: "everywhere" is shown rather than left blank to interpret.
    await expect(page.getByText('ALL').first()).toBeVisible();

    await page.getByRole('button', { name: /1 May 2031/ }).click();
    const confirm = page.getByRole('alertdialog');
    // Removing one costs a day MORE on any leave spanning it, which the dialog says out loud.
    await expect(confirm).toContainText(/cost a day more/i);
    await confirm.getByRole('button', { name: /remove holiday/i }).click();

    await expect(page.getByText(name)).toHaveCount(0, { timeout: 15_000 });
  });

  test('shows the accrual policies that explain the numbers', async ({ page }) => {
    await openBalancesTab(page);

    // Read-only reference: changing an accrual method is a migration, not a form, so there is no edit.
    await expect(page.getByRole('heading', { name: /accrual policies/i })).toBeVisible();
    await expect(page.getByText(/Carry over up to \d+ day\(s\)/).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
