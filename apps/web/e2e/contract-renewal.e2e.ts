import { test } from './support/test';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  chooseFromPicker,
  csrfHeaders,
  expect,
  expectRowSomewhere,
  gotoInShell,
} from './support/fixtures';

/**
 * Contract renewal — a swap between two contracts — and the employment history it produces.
 *
 * WHAT THIS PINS THAT NOTHING ELSE CAN
 * ------------------------------------
 * - renewing EXPIRES the outgoing contract and ACTIVATES the incoming one in one transaction, so the employee
 *   is never left with two live contracts or none (`uq_employee_active_contract` is what makes that atomic)
 * - only an ACTIVE contract offers Renew: the service refuses any other outgoing status
 * - the picker offers only DRAFTS for the same employee, because that is all the service accepts
 * - the history reads the chain back, with the superseded contract still on it
 */

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`.toUpperCase();
}

async function createEmployee(request: APIRequestContext): Promise<string> {
  const tag = unique('PWC');
  const res = await request.post('/v1/employees', {
    headers: await csrfHeaders(request),
    data: {
      email: `${tag.toLowerCase()}@opshub.local`,
      displayName: `Contract Holder ${tag}`,
      firstName: 'Contract',
      lastName: tag,
      employmentType: 'full_time',
      startDate: '2026-01-01',
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function draftContract(
  request: APIRequestContext,
  employeeId: string,
  over: Record<string, unknown> = {},
): Promise<{ id: string; reference: string }> {
  const reference = unique('EC');
  const res = await request.post('/v1/contracts', {
    headers: await csrfHeaders(request),
    data: {
      employeeId,
      reference,
      contractType: 'permanent',
      startDate: '2026-02-01',
      noticePeriodDays: 30,
      ...over,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return { id: ((await res.json()) as { id: string }).id, reference };
}

async function activate(request: APIRequestContext, id: string): Promise<void> {
  const res = await request.post(`/v1/contracts/${id}/activate`, {
    headers: await csrfHeaders(request),
    data: { signedAt: '2026-01-20T09:00:00.000Z' },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

/**
 * Open a contract by reference.
 *
 * `expectRowSomewhere` rather than a search box: this register has status filters and a pager but no search,
 * so a row can legitimately be on a later page — and walking to it is what keeps the spec about renewal
 * instead of about pagination.
 */
async function openContract(page: Page, reference: string) {
  await expectRowSomewhere(page, reference);
  const row = page.locator('tbody tr', { hasText: reference });
  await row.locator('td').first().click();
  const drawer = page.getByRole('dialog', { name: new RegExp(reference) });
  await expect(drawer).toBeVisible();
  return { row, drawer };
}

test.describe('contract renewal', () => {
  test('swaps the active contract for a drafted one, and the history keeps both', async ({
    page,
    request,
  }) => {
    const employeeId = await createEmployee(request);
    const outgoing = await draftContract(request, employeeId);
    await activate(request, outgoing.id);
    const incoming = await draftContract(request, employeeId, {
      startDate: '2027-02-01',
      contractType: 'fixed_term',
      endDate: '2028-01-31',
    });

    await gotoInShell(page, '/contracts');
    const { drawer } = await openContract(page, outgoing.reference);

    await drawer.getByRole('button', { name: 'Renew' }).click();
    const dialog = page.getByRole('dialog', { name: new RegExp(`Renew ${outgoing.reference}`) });
    // The picker only offers drafts for THIS employee: anything else is a refusal the service owns.
    await chooseFromPicker(page, dialog, 'Incoming contract', incoming.reference);
    await dialog.getByRole('button', { name: /renew contract/i }).click();
    await expect(dialog).toBeHidden();

    // The drawer is modal, so its overlay covers the filter strip — dismiss it before touching the page.
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();

    // ONE transaction, two rows moved: the outgoing contract left `active`, so it is gone from the filter
    // the page opens on.
    await expect(page.locator('tbody tr', { hasText: outgoing.reference })).toHaveCount(0, {
      timeout: 15_000,
    });

    // Read the chain from the OUTGOING side: its own drawer lists the employee's whole history, so both
    // contracts are assertable from one place — and it avoids a second walk through the active pager.
    // `All`, because the register's filters are draft/active/expiring/terminated — an EXPIRED contract has
    // no filter of its own, which is itself worth knowing: it is only reachable unfiltered.
    await page.getByRole('radio', { name: 'All' }).click();
    const { drawer: expiredDrawer } = await openContract(page, outgoing.reference);

    const outgoingRow = expiredDrawer.getByRole('article', {
      name: `Contract ${outgoing.reference}`,
    });
    await expect(outgoingRow).toContainText('Expired', { timeout: 15_000 });
    // The incoming contract is on the same history, and it is the one now in force.
    const incomingRow = expiredDrawer.getByRole('article', {
      name: `Contract ${incoming.reference}`,
    });
    await expect(incomingRow).toContainText('Active');
  });

  test('only an active contract offers Renew', async ({ page, request }) => {
    const employeeId = await createEmployee(request);
    const draft = await draftContract(request, employeeId);

    await gotoInShell(page, '/contracts');
    await page.getByRole('radio', { name: 'Draft' }).click();
    const { drawer } = await openContract(page, draft.reference);

    // A draft has nothing to renew: renewal is a swap FROM something in force.
    await expect(drawer.getByRole('button', { name: 'Renew' })).toHaveCount(0);
  });
});
