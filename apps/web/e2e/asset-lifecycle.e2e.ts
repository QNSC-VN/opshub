import { test } from './support/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { chooseFromPicker, csrfHeaders, expect, gotoInShell } from './support/fixtures';

/**
 * The asset lifecycle — assign, return, retire — and the custody history over it.
 *
 * WHAT THIS PINS THAT NOTHING ELSE CAN
 * ------------------------------------
 * - assigning opens a custody row that stays after the asset comes back, which is what answers "who had this
 *   laptop when the data on it leaked"
 * - an ASSIGNED asset is not offered Retire: the service refuses it until the hardware is back, because
 *   retiring in place leaves the holder responsible for something the register says is gone
 * - a RETIRED asset offers nothing at all, and is out of the assignable pool for good
 * - returning closes the open row rather than deleting it
 */

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`.toUpperCase();
}

async function createAsset(request: APIRequestContext): Promise<{ id: string; tag: string }> {
  const tag = unique('PWA');
  const res = await request.post('/v1/assets', {
    headers: await csrfHeaders(request),
    data: { assetTag: tag, type: 'laptop', manufacturer: 'Playwright', model: 'Test 14' },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { id: string };
  return { id: body.id, tag };
}

async function createEmployee(request: APIRequestContext): Promise<{ id: string; name: string }> {
  const tag = unique('PWH');
  const res = await request.post('/v1/employees', {
    headers: await csrfHeaders(request),
    data: {
      email: `${tag.toLowerCase()}@opshub.local`,
      displayName: `Asset Holder ${tag}`,
      firstName: 'Asset',
      lastName: tag,
      employmentType: 'full_time',
      startDate: '2026-01-01',
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { id: string };
  return { id: body.id, name: `Asset Holder ${tag}` };
}

async function findRow(page: Page, tag: string) {
  await page.getByRole('searchbox').fill(tag);
  const row = page.locator('tbody tr', { hasText: tag });
  await expect(row).toBeVisible({ timeout: 15_000 });
  return row;
}

test.describe('asset lifecycle', () => {
  test('assigns an asset, and the custody row stays after it comes back', async ({
    page,
    request,
  }) => {
    const asset = await createAsset(request);
    const holder = await createEmployee(request);

    await gotoInShell(page, '/assets');
    let row = await findRow(page, asset.tag);
    await expect(row).toContainText('In stock');

    await row.getByRole('button', { name: 'Assign' }).click();
    const dialog = page.getByRole('dialog', { name: new RegExp(`Assign ${asset.tag}`) });
    await chooseFromPicker(page, dialog, 'Assign to', holder.name);
    await dialog.getByLabel(/^Notes/).fill('Loan for the Berlin trip, back on the 14th.');
    await dialog.getByRole('button', { name: /assign asset/i }).click();
    await expect(dialog).toBeHidden();

    row = page.locator('tbody tr', { hasText: asset.tag });
    await expect(row).toContainText('Assigned', { timeout: 15_000 });

    // ASSIGNED CANNOT BE RETIRED. The hardware has to come back first, so the action is withheld rather
    // than offered and refused.
    await expect(row.getByRole('button', { name: 'Retire' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Return' })).toBeVisible();

    // The custody row, with the note that makes it readable later.
    await row.locator('td').first().click();
    const drawer = page.getByRole('dialog', { name: new RegExp(asset.tag) });
    await expect(drawer.getByText('Holding it now')).toBeVisible({ timeout: 15_000 });
    await expect(drawer.getByText(/Berlin trip/)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();

    // RETURNING CLOSES the row rather than deleting it: the history is the evidence.
    await page
      .locator('tbody tr', { hasText: asset.tag })
      .getByRole('button', { name: 'Return' })
      .click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText(/stays on the history/i);
    await confirm.getByRole('button', { name: /return to stock/i }).click();

    row = page.locator('tbody tr', { hasText: asset.tag });
    await expect(row).toContainText('In stock', { timeout: 15_000 });

    await row.locator('td').first().click();
    const reopened = page.getByRole('dialog', { name: new RegExp(asset.tag) });
    // Still there, now closed with a return date — not removed.
    await expect(reopened.getByText(/returned /)).toBeVisible({ timeout: 15_000 });
    await expect(reopened.getByText(/Berlin trip/)).toBeVisible();
    await expect(reopened.getByText('Holding it now')).toHaveCount(0);
  });

  test('a retired asset offers nothing, and its history stays readable', async ({
    page,
    request,
  }) => {
    const asset = await createAsset(request);

    await gotoInShell(page, '/assets');
    let row = await findRow(page, asset.tag);

    await row.getByRole('button', { name: 'Retire' }).click();
    const confirm = page.getByRole('alertdialog');
    // The consequence, stated: out of the assignable pool for good.
    await expect(confirm).toContainText(/assignable pool for good/i);
    await confirm.getByRole('button', { name: /retire asset/i }).click();

    row = page.locator('tbody tr', { hasText: asset.tag });
    await expect(row).toContainText('Retired', { timeout: 15_000 });
    // Nothing further: assigning a written-off device is how one ends up on a desk and off the register.
    await expect(row.getByRole('button', { name: 'Assign' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Retire' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Return' })).toHaveCount(0);
  });

  test('filters the register by status', async ({ page, request }) => {
    const asset = await createAsset(request);

    await gotoInShell(page, '/assets');
    await findRow(page, asset.tag);

    // A new asset is in stock, so the Retired filter must exclude it — a filter that quietly ignores its
    // value is the defect this catches.
    await page.getByRole('radio', { name: 'Retired' }).click();
    await expect(page.locator('tbody tr', { hasText: asset.tag })).toHaveCount(0, {
      timeout: 15_000,
    });

    await page.getByRole('radio', { name: 'In stock' }).click();
    await expect(page.locator('tbody tr', { hasText: asset.tag })).toBeVisible({ timeout: 15_000 });
  });
});
