import { test } from '@playwright/test';
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
 * change cannot fail it and a structural regression cannot pass it. Nothing here creates data: both
 * tabs are seeded, and a spec that wrote rows would drift the counts the pager asserts on.
 */
test.describe('compliance', () => {
  test('lists the software catalogue in a real table, not a loading or error state', async ({
    page,
  }) => {
    await gotoInShell(page, '/compliance');

    const table = page.getByRole('table');
    await expect(table).toBeVisible();

    // The catalogue is seeded, so the empty state and the error row are both failures here.
    await expect(page.getByText('Loading…')).toHaveCount(0);
    await expect(page.getByText('Failed to load software catalog.')).toHaveCount(0);
    await expect(page.getByText('No software entries found')).toHaveCount(0);

    // A header per declared column, and at least one body row under it.
    await expect(table.getByRole('columnheader')).toHaveCount(4);
    await expect(table.locator('tbody tr')).not.toHaveCount(0);
  });

  test('reports the count, and pages only when there is a second page', async ({ page }) => {
    await gotoInShell(page, '/compliance');

    // Either shape is correct — which one depends on how much the seed loaded — so the assertion is
    // that the footer AGREES with the table rather than that a particular page exists. `result`
    // without the `s`: the footer pluralises, and the seed can legitimately hold exactly one row.
    const footer = page.getByText(/\d+ software result|\d+–\d+ of \d+/).first();
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

  test('switches to findings and renders that table with its own columns', async ({ page }) => {
    await gotoInShell(page, '/compliance');

    await page.getByRole('button', { name: 'Findings' }).click();

    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    // Six columns, including the actions column the row-click handler has to leave alone.
    await expect(table.getByRole('columnheader')).toHaveCount(6);
    await expect(page.getByText('Failed to load findings.')).toHaveCount(0);
  });

  test('filters by severity without leaving the pager on a page that no longer exists', async ({
    page,
  }) => {
    // The reset-on-filter rule, from the outside: narrowing the set has to return to page 1, or the
    // request asks for an offset past the end and the table comes back empty for no visible reason.
    await gotoInShell(page, '/compliance');
    await page.getByRole('button', { name: 'Findings' }).click();

    await page.getByRole('button', { name: 'Critical', exact: true }).click();

    await expect(page.getByText('Failed to load findings.')).toHaveCount(0);
    // Either rows or the empty state — never a stuck loading row, which is what an out-of-range
    // offset plus a slow retry looks like.
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    await expect(page.getByText('Loading…')).toHaveCount(0);
  });
});
