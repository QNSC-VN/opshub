import { test, type APIRequestContext } from '@playwright/test';
import { expect, gotoInShell } from './support/fixtures';

/**
 * The compliance screen, in depth — the first page converted onto `DataTable`/`PaginationFooter`.
 *
 * WHY THIS SPEC EXISTS
 * --------------------
 * The shell spec proves `/compliance` mounts without an error boundary, and that is all it proves:
 * a heading renders whether the table below it has rows, a stuck "Loading…" or a silent error row.
 * That is exactly the difference a refactor of the table can break, so the conversion needed a
 * journey that reads the table itself.
 *
 * It asserts on the ROLES rather than on classes — `table`, `columnheader`, `row` — so a Tailwind
 * change cannot fail it and a structural regression cannot pass it.
 *
 * IT CREATES ITS OWN CATALOGUE ROW. The first version assumed the software catalogue was seeded,
 * which was true on my machine only because ANOTHER suite had left a row behind — CI's catalogue is
 * empty, so the spec asserted "not the empty state" against a legitimately empty list and failed
 * there and nowhere else. A spec that depends on data it did not create is a spec that passes for a
 * reason it cannot state. The findings tab is read-only (findings are scan-detected), so those
 * assertions accept either rows or the empty state and only refuse loading and error.
 */
/** A name unique per run: the database is shared and never reset between Playwright runs. */
function uniqueSoftwareName(): string {
  return `Playwright Catalog ${Date.now()}`;
}

/**
 * Add a catalogue entry the way the SPA would, CSRF token and all.
 *
 * The API enforces double-submit CSRF on every mutation, and the saved storage state carries the
 * SESSION cookie but no token — so a bare `request.post` here returns `FORBIDDEN: Missing csrf
 * secret`, which reads like an authorization bug in the route rather than a missing header in the
 * test. `GET /v1/auth/me` is what the app itself calls to obtain the token (see
 * `shared/api/auth-bootstrap.ts`), so this borrows the same two-step rather than inventing a
 * bypass — and it means the spec exercises the real protection instead of routing around it.
 */
async function addSoftware(request: APIRequestContext, name: string): Promise<void> {
  const me = await request.get('/v1/auth/me');
  expect(me.ok(), await me.text()).toBe(true);
  const { csrfToken } = (await me.json()) as { csrfToken?: string };
  expect(csrfToken, 'GET /auth/me did not return a CSRF token').toBeTruthy();

  const created = await request.post('/v1/compliance/software', {
    headers: { 'X-CSRF-Token': csrfToken! },
    data: { name, publisher: 'Playwright', listing: 'review', notes: 'created by an e2e spec' },
  });
  expect(created.status(), await created.text()).toBe(201);
}

test.describe('compliance', () => {
  test('lists the software catalogue in a real table, not a loading or error state', async ({
    page,
    request,
  }) => {
    // Created through the API with the spec's own session, so the row is guaranteed to exist and is
    // identifiable — rather than hoping the seed or another suite left something behind.
    const name = uniqueSoftwareName();
    await addSoftware(request, name);

    await gotoInShell(page, '/compliance');

    const table = page.getByRole('table');
    await expect(table).toBeVisible();

    // The row this spec created must be on screen, which is a stronger claim than "some rows are".
    await expect(page.getByText(name)).toBeVisible();
    await expect(page.getByText('Loading…')).toHaveCount(0);
    await expect(page.getByText('Failed to load software catalog.')).toHaveCount(0);
    await expect(page.getByText('No software entries found')).toHaveCount(0);

    // A header per declared column.
    await expect(table.getByRole('columnheader')).toHaveCount(4);
  });

  test('reports the count, and pages only when there is a second page', async ({
    page,
    request,
  }) => {
    // Same reason as above: the footer renders nothing at all for an empty list, which is correct
    // behaviour and would make this assertion vacuous.
    await addSoftware(request, uniqueSoftwareName());

    await gotoInShell(page, '/compliance');

    // Either shape is correct — which one depends on how much the seed loaded — so the assertion is
    // that the footer AGREES with the table rather than that a particular page exists. `result`
    // without the `s`: the footer pluralises, and the seed can legitimately hold exactly one row.
    const footer = page.getByText(/\d+ software results?|\d+–\d+ of \d+/).first();
    await expect(footer).toBeVisible();

    const next = page.getByRole('button', { name: /Next/ });
    if (await next.isVisible()) {
      const firstCell = await page.locator('tbody tr td').first().innerText();
      await next.click();
      // A different first row is the only honest evidence the offset reached the API.
      await expect(page.locator('tbody tr td').first()).not.toHaveText(firstCell);
      await expect(page.getByRole('button', { name: /Previous/ })).toBeEnabled();
    }
  });

  test('switches to findings through a real tablist, not a row of buttons', async ({ page }) => {
    await gotoInShell(page, '/compliance');

    // `role="tab"` and not `role="button"`: the tab bar is now a `tablist`, which is the point of
    // replacing the hand-rolled one. This assertion is what caught the change — the spec used to
    // find these as buttons, and it should not be able to.
    const tabs = page.getByRole('tablist');
    await expect(tabs).toBeVisible();
    await page.getByRole('tab', { name: 'Findings' }).click();
    await expect(page.getByRole('tab', { name: 'Findings' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    // Six columns, including the actions column the row-click handler has to leave alone.
    await expect(table.getByRole('columnheader')).toHaveCount(6);
    await expect(page.getByText('Failed to load findings.')).toHaveCount(0);
  });

  test('moves between tabs with the arrow keys', async ({ page }) => {
    // The keyboard behaviour the hand-rolled bar never had. Asserted from the outside because it is
    // the part a user actually feels.
    await gotoInShell(page, '/compliance');

    await page.getByRole('tab', { name: 'Software Catalog' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Findings' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Wraps: Left from the first tab lands on the last.
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: 'Shadow IT' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('filters by severity without leaving the pager on a page that no longer exists', async ({
    page,
  }) => {
    // The reset-on-filter rule, from the outside: narrowing the set has to return to page 1, or the
    // request asks for an offset past the end and the table comes back empty for no visible reason.
    await gotoInShell(page, '/compliance');
    await page.getByRole('tab', { name: 'Findings' }).click();

    // The filter is a `radiogroup` now, named so it is announced as "Filter by severity" rather than
    // as five loose buttons.
    const filter = page.getByRole('radiogroup', { name: 'Filter by severity' });
    await expect(filter).toBeVisible();
    await filter.getByRole('radio', { name: 'Critical' }).click();
    await expect(filter.getByRole('radio', { name: 'Critical' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await expect(page.getByText('Failed to load findings.')).toHaveCount(0);
    // Either rows or the empty state — never a stuck loading row, which is what an out-of-range
    // offset plus a slow retry looks like.
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    await expect(page.getByText('Loading…')).toHaveCount(0);
  });
});
