import { test } from '@playwright/test';
import {
  clickFirstRow,
  createAccessRequest,
  csrfHeaders,
  expect,
  gotoInShell,
} from './support/fixtures';

/**
 * The inbox, the asset register and the service catalog — the three screens converted together.
 *
 * Each gets the assertion its conversion needs and no more: the inbox's footer count (its query used
 * to cast the response to `{ data, total }`, so the footer read "Showing 12 of undefined requests"),
 * the asset register's dialog and search, and the catalog's request flow — which used to enforce its
 * minimum reason length only by disabling the button.
 */
test.describe('requests inbox', () => {
  test('filters through a radiogroup and reports a real count', async ({ page, request }) => {
    // A FRESH database has no requests at all — CI's did not, mine did, and the footer correctly
    // renders nothing for an empty list, so this asserted against data it had not created.
    await createAccessRequest(request);
    await gotoInShell(page, '/requests');

    const filter = page.getByRole('radiogroup', { name: /filter requests/i });
    await expect(filter).toBeVisible();
    // Opens on "My queue"; "All" is the wider set and is what the count below is asserted against.
    await filter.getByRole('radio', { name: 'All' }).click();
    await expect(filter.getByRole('radio', { name: 'All' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // The footer prints a NUMBER, not `undefined`. That is the whole regression.
    await expect(page.getByText(/\d+ requests? results?|\d+–\d+ of \d+/)).toBeVisible();
    await expect(page.getByText(/of undefined/)).toHaveCount(0);
  });

  test('opens a request drawer with its approval history', async ({ page, request }) => {
    await createAccessRequest(request);
    await gotoInShell(page, '/requests');
    await page.getByRole('radiogroup').getByRole('radio', { name: 'All' }).click();

    await clickFirstRow(page);
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'Details' })).toBeVisible();
    await expect(drawer.getByText('Requester')).toBeVisible();
  });
});

test.describe('assets', () => {
  test('adds an asset through a dialog and finds it by search', async ({ page }) => {
    const tag = `PW-${Date.now()}`;
    await gotoInShell(page, '/assets');

    await page.getByRole('button', { name: /add asset/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Asset tag').fill(tag);
    await dialog.getByLabel('Manufacturer').fill('Playwright');
    await dialog.getByLabel('Model').fill('Test Model');
    await dialog.getByRole('button', { name: 'Add asset' }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('searchbox').fill(tag);
    await expect(page.locator('tbody tr', { hasText: tag })).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('service catalog', () => {
  test('states why a too-short reason is refused, rather than only disabling the button', async ({
    page,
    request,
  }) => {
    // CREATES ITS OWN ITEM. The dev catalogue is EMPTY — the seed does not populate it — so a spec that
    // clicked "the first item" found nothing. Second time this lesson has cost a run (the compliance
    // journey assumed a seeded software catalogue), which is why the rule is now in the kit README:
    // create what you assert on.
    const name = `Playwright Item ${Date.now()}`;
    const created = await request.post('/v1/catalog', {
      headers: await csrfHeaders(request),
      data: {
        name,
        category: 'hardware',
        approvalPermission: 'asset.write',
        description: 'Created by an e2e spec',
        slaHours: 24,
      },
    });
    expect(created.status(), await created.text()).toBe(201);

    await gotoInShell(page, '/catalog');

    const item = page.getByRole('button', { name: new RegExp(name) });
    await expect(item).toBeVisible();
    await item.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: /submit request/i }).click();
    // A message, not a silently inert button.
    await expect(dialog.getByText(/at least 10 characters/i)).toBeVisible();

    await dialog.getByLabel(/why do you need this/i).fill('Needed for onboarding the new starter.');
    await dialog.getByRole('button', { name: /submit request/i }).click();
    await expect(dialog).toBeHidden();
  });
});
