import { test } from './support/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { chooseFromPicker, csrfHeaders, expect, gotoInShell } from './support/fixtures';

/**
 * Licence seats — the half of FinOps that existed only in the API.
 *
 * WHAT THIS PINS THAT NOTHING ELSE CAN
 * ------------------------------------
 * - a seat is a SPEND decision as well as an access one, so the cost and the remaining capacity sit next to
 *   the button that hands one out
 * - a FULL licence does not offer another seat: the API refuses `used >= seatCount`, and the panel says what
 *   to do instead rather than letting somebody find out from a toast
 * - revoking is SOFT — the row stays with a revoked date, because "who had a seat in March" is what a
 *   true-up asks — and it frees the seat immediately
 * - a licence with no seat count is UNMETERED, which is a different state from full
 */

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`.toUpperCase();
}

async function createLicense(
  request: APIRequestContext,
  over: Record<string, unknown> = {},
): Promise<{ id: string; name: string }> {
  const name = `Playwright Suite ${unique('PWL')}`;
  const res = await request.post('/v1/licenses', {
    headers: await csrfHeaders(request),
    data: {
      name,
      vendor: 'Playwright Software',
      licenseType: 'subscription',
      seatCount: 1,
      costPerSeatCents: 1500,
      ...over,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { id: string };
  return { id: body.id, name };
}

async function createEmployee(request: APIRequestContext): Promise<{ id: string; name: string }> {
  const tag = unique('PWS');
  const res = await request.post('/v1/employees', {
    headers: await csrfHeaders(request),
    data: {
      email: `${tag.toLowerCase()}@opshub.local`,
      displayName: `Seat Holder ${tag}`,
      firstName: 'Seat',
      lastName: tag,
      employmentType: 'full_time',
      startDate: '2026-01-01',
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { id: string };
  return { id: body.id, name: `Seat Holder ${tag}` };
}

async function openLicence(page: Page, name: string) {
  await page.getByRole('searchbox').fill(name);
  const row = page.locator('tbody tr', { hasText: name });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.locator('td').first().click();
  const drawer = page.getByRole('dialog', { name: new RegExp(name) });
  await expect(drawer).toBeVisible();
  return { row, drawer };
}

test.describe('licence seats', () => {
  test('assigns the only seat, then refuses to offer another until one is freed', async ({
    page,
    request,
  }) => {
    const licence = await createLicense(request); // one seat
    const holder = await createEmployee(request);

    await gotoInShell(page, '/finops');
    const { drawer } = await openLicence(page, licence.name);

    // Capacity and cost, where the decision is made.
    await expect(drawer.getByText(/0 of 1 seat\(s\) in use/)).toBeVisible({ timeout: 15_000 });
    await expect(drawer.getByText(/1 free/)).toBeVisible();

    await drawer.getByRole('button', { name: /assign a seat/i }).click();
    const dialog = page.getByRole('dialog', { name: /assign a .* seat/i });
    // The per-seat cost is stated in the form: this is a spend decision.
    await expect(dialog.getByText(/Each seat costs/)).toBeVisible();
    await chooseFromPicker(page, dialog, 'Assign to', holder.name);
    await dialog.getByLabel(/^Notes/).fill('Design tooling for the rebrand.');
    await dialog.getByRole('button', { name: /assign seat/i }).click();
    await expect(dialog).toBeHidden();

    await expect(drawer.getByText(/1 of 1 seat\(s\) in use/)).toBeVisible({ timeout: 15_000 });
    // Scoped to the seat row: the drawer's Details list carries the licence's own "Active" status.
    const seat = drawer.getByRole('article').filter({ hasText: 'Design tooling' });
    await expect(seat.getByText('Active')).toBeVisible();

    // FULL: the action is withheld and the alternative is named, rather than offering a refusal.
    await expect(drawer.getByRole('button', { name: /assign a seat/i })).toHaveCount(0);
    await expect(drawer.getByText(/Every seat is in use/i)).toBeVisible();
  });

  test('revoking is soft: the seat frees up and the row stays', async ({ page, request }) => {
    const licence = await createLicense(request, { seatCount: 2 });
    const holder = await createEmployee(request);

    // Assigned through the API so the test is about the revoke, not the assign.
    const assigned = await request.post(`/v1/licenses/${licence.id}/assignments`, {
      headers: await csrfHeaders(request),
      data: { employeeId: holder.id, notes: 'Temporary seat.' },
    });
    expect(assigned.status(), await assigned.text()).toBe(201);

    await gotoInShell(page, '/finops');
    const { drawer } = await openLicence(page, licence.name);
    await expect(drawer.getByText(/1 of 2 seat\(s\) in use/)).toBeVisible({ timeout: 15_000 });

    // `exact`, because the "Include revoked" toggle also contains the word.
    await drawer.getByRole('button', { name: 'Revoke', exact: true }).click();

    // The seat frees immediately…
    await expect(drawer.getByText(/0 of 2 seat\(s\) in use/)).toBeVisible({ timeout: 15_000 });
    // …and by default the list shows only what is in use, so the revoked row is out of the way.
    await expect(drawer.getByRole('article').filter({ hasText: 'Active' })).toHaveCount(0);
    await expect(drawer.getByText(/No seats in use/)).toBeVisible();

    // But it is NOT gone: a true-up asks who held a seat in March.
    await drawer.getByRole('button', { name: 'Include revoked' }).click();
    await expect(drawer.getByText(/revoked /)).toBeVisible({ timeout: 15_000 });
    await expect(drawer.getByText(/Temporary seat/)).toBeVisible();
  });

  test('a licence with no seat count reads as unmetered, not as full', async ({
    page,
    request,
  }) => {
    const licence = await createLicense(request, { seatCount: null });

    await gotoInShell(page, '/finops');
    const { drawer } = await openLicence(page, licence.name);

    // Unmetered is a different state from full, and the API only enforces a cap when a count exists — so a
    // seat is still assignable here.
    await expect(drawer.getByText(/No seat count declared/i)).toBeVisible({ timeout: 15_000 });
    await expect(drawer.getByRole('button', { name: /assign a seat/i })).toBeVisible();
    await expect(drawer.getByText(/Every seat is in use/i)).toHaveCount(0);
  });
});
