import { test } from '@playwright/test';
import {
  chooseFromPicker,
  createRisk,
  csrfHeaders,
  expect,
  expectRowSomewhere,
  gotoInShell,
  myEmployeeId,
} from './support/fixtures';

/**
 * The ISMS risk register and the Statement of Applicability — and the link that makes both answerable.
 *
 * WHAT THIS PINS THAT NOTHING ELSE CAN
 * ------------------------------------
 * - a risk cannot be marked TREATED while a treatment action is outstanding (a count across rows)
 * - accepting a risk in the HIGH BAND raises an approval request and leaves the risk unchanged, while
 *   accepting a low one records the acceptance directly — two different outcomes from one button, and
 *   the screen has to say which happened
 * - the SoA's `undecided` count is controls with NO entry, which is a different finding from excluded
 * - a control decided from the catalogue appears in the SoA, because those are two views of one row
 *
 * Everything asserted here is created here. The Annex A catalogue, on the other hand, is expected to
 * exist: it ships in migration 0030, and a database without it reports "0 of 0 controls" — which reads as
 * full coverage and is the reason that migration exists.
 */

function unique(prefix: string): string {
  return `${prefix}-${Date.now()}`;
}

/** A risk at a chosen severity, created through the API so a spec starts where it needs to. */
test.describe('risk register', () => {
  test('identifies a risk and shows its score in the high band', async ({ page }) => {
    const reference = unique('PWR').toUpperCase();
    await gotoInShell(page, '/risks');

    await page.getByRole('button', { name: /identify a risk/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Reference').fill(reference);
    await dialog.getByLabel('Category').fill('Access control');
    await dialog.getByLabel('Title').fill('Shared admin credentials for the billing console');
    await dialog.getByLabel('Description').fill('Anybody with the shared password can move money.');
    await chooseFromPicker(page, dialog, 'Owner', 'Admin');
    await dialog.getByLabel('Likelihood').selectOption('4');
    await dialog.getByLabel('Impact').selectOption('5');
    // The score is shown WHILE choosing, and it comes from the two factors — the row's own score is a
    // generated column, so this is the one place the product does the arithmetic, for display only.
    await expect(dialog.getByText(/Score 20/)).toBeVisible();
    await expect(dialog.getByText(/high band: accepting this needs sign-off/i)).toBeVisible();
    await dialog.getByRole('button', { name: /record risk/i }).click();
    await expect(dialog).toBeHidden();

    await expectRowSomewhere(page, reference);
    const row = page.locator('tbody tr', { hasText: reference });
    await expect(row).toContainText('20');
    // Never assessed, so there is no residual — stated rather than left blank.
    await expect(row).toContainText('Not assessed');
    await expect(row).toContainText('Identified');

    // AND NO ACCEPT ACTION, because acceptance is about the residual: the API refuses an unassessed risk
    // with "assess it before accepting it". This assertion is here because a mutation test caught its
    // absence — with the gate removed, every other assertion in this file still passed.
    await expect(row.getByRole('button', { name: /^Accept$/ })).toHaveCount(0);
    await expect(row.getByRole('button', { name: /^Assess$/ })).toBeVisible();
  });

  test('refuses to mark a risk treated while an action is outstanding', async ({
    page,
    request,
  }) => {
    const risk = await createRisk(request, unique('PWT').toUpperCase(), 3, 3);
    const ownerId = await myEmployeeId(request);

    // Assess it so "Mark treated" is offered at all, then leave an action open.
    const assessed = await request.post(`/v1/risks/${risk.id}/assess`, {
      headers: await csrfHeaders(request),
      data: { decision: 'mitigate', residual: { likelihood: 2, impact: 2 } },
    });
    expect(assessed.status(), await assessed.text()).toBe(200);
    const treatment = await request.post(`/v1/risks/${risk.id}/treatments`, {
      headers: await csrfHeaders(request),
      data: { description: 'Move the console behind SSO', ownerId },
    });
    expect(treatment.status(), await treatment.text()).toBe(201);

    await gotoInShell(page, '/risks');
    await expectRowSomewhere(page, risk.reference);
    await page
      .locator('tbody tr', { hasText: risk.reference })
      .getByRole('button', { name: /mark treated/i })
      .click();

    const confirm = page.getByRole('alertdialog');
    await expect(confirm.getByText(/still outstanding/i)).toBeVisible();
    await confirm.getByRole('button', { name: /mark treated/i }).click();

    // The API refuses and the screen shows ITS message — the count is not re-implemented here.
    await expect(page.getByText(/outstanding|not treated|treatment/i).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('tbody tr', { hasText: risk.reference })).toContainText('Assessed');

    // The drawer names how many remain, which is what turns the refusal into something actionable.
    await page.locator('tbody tr', { hasText: risk.reference }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('heading', { name: 'Treatment plan' })).toBeVisible();
    await expect(drawer.getByText(/1 action\(s\) outstanding/)).toBeVisible();
  });

  test('a low-band acceptance is recorded, and a high-band one goes for approval', async ({
    page,
    request,
  }) => {
    // ONE BUTTON, TWO OUTCOMES, decided by the API from the residual score. The dialog says which is
    // about to happen and the toast says which did — "accepted" and "waiting for somebody to accept" are
    // very different answers to "is this risk carried".
    const low = await createRisk(request, unique('PWL').toUpperCase(), 1, 2);
    const high = await createRisk(request, unique('PWH').toUpperCase(), 5, 4);

    // ASSESSED FIRST, because acceptance is about the RESIDUAL: the API refuses an unassessed risk with
    // "assess it before accepting it", and the register does not offer the action without one. Found by
    // driving it — the first version of this spec accepted straight from `identified`.
    for (const [risk, residual] of [
      [low, { likelihood: 1, impact: 2 }],
      [high, { likelihood: 5, impact: 4 }],
    ] as const) {
      const assessed = await request.post(`/v1/risks/${risk.id}/assess`, {
        headers: await csrfHeaders(request),
        data: { decision: 'accept', residual },
      });
      expect(assessed.status(), await assessed.text()).toBe(200);
    }

    await gotoInShell(page, '/risks');

    await expectRowSomewhere(page, low.reference);
    await page
      .locator('tbody tr', { hasText: low.reference })
      .getByRole('button', { name: /^Accept$/ })
      .click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/Below the high band/i)).toBeVisible();
    await dialog
      .getByLabel('Justification')
      .fill('Two-person process already makes this unlikely.');
    await dialog.getByRole('button', { name: /^Accept risk$/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('tbody tr', { hasText: low.reference })).toContainText('Accepted', {
      timeout: 15_000,
    });

    await expectRowSomewhere(page, high.reference);
    await page
      .locator('tbody tr', { hasText: high.reference })
      .getByRole('button', { name: /^Accept$/ })
      .click();
    dialog = page.getByRole('dialog');
    // The dialog names the consequence BEFORE the click, because the button's label changes with it.
    await expect(dialog.getByText(/raises an approval request/i)).toBeVisible();
    await dialog.getByLabel('Justification').fill('Carrying this until the migration lands in Q3.');
    await dialog.getByRole('button', { name: /send for approval/i }).click();
    await expect(dialog).toBeHidden();

    // The RISK IS UNCHANGED — nothing is accepted until somebody signs it off.
    await expect(page.getByText(/sent for approval/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('tbody tr', { hasText: high.reference })).not.toContainText(
      'Accepted',
    );
  });
});

test.describe('statement of applicability', () => {
  test('counts undecided controls, and deciding one moves it into the SoA', async ({ page }) => {
    await gotoInShell(page, '/controls');

    // The Annex A catalogue exists, so coverage is a real denominator rather than zero. A database
    // without migration 0030 reports "0 of 0", which is what this assertion exists to refuse.
    const undecided = page.getByText(/of \d+ controls/);
    await expect(undecided).toBeVisible({ timeout: 15_000 });
    await expect(undecided).not.toContainText('of 0 controls');

    // Decide one from the CATALOGUE, which is the only place an undecided control can be reached.
    await page.getByRole('tab', { name: /control catalogue/i }).click();
    const firstRow = page
      .locator('tbody tr')
      .filter({ has: page.locator('td:nth-child(2)') })
      .first();
    const reference = (await firstRow.locator('td').first().innerText()).trim();
    await firstRow.getByRole('button', { name: 'Decide' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Status').selectOption('implemented');
    await dialog
      .getByLabel('Justification')
      .fill('Applies here — the policy set is reviewed annually by the security lead.');
    await dialog.getByRole('button', { name: /save entry/i }).click();
    await expect(dialog).toBeHidden();

    // Now in the SoA, which is the same row read from the other side.
    await page.getByRole('tab', { name: /statement of applicability/i }).click();
    await expectRowSomewhere(page, reference);
    // EXACT text, not `hasText`. Control references nest — `E2E-C-X-1` is a prefix of `E2E-C-X-12`, and
    // the API suites mint references exactly like that — so a substring filter matched four rows and
    // Playwright rightly refused to guess which one the assertion meant.
    const soaRow = page
      .locator('tbody tr')
      .filter({ has: page.getByText(reference, { exact: true }) });
    await expect(soaRow).toContainText('Applicable');
    await expect(soaRow).toContainText('Implemented');
  });

  test('an exclusion still demands a justification, and drops the implementation fields', async ({
    page,
  }) => {
    await gotoInShell(page, '/controls');
    await page.getByRole('tab', { name: /control catalogue/i }).click();

    const row = page
      .locator('tbody tr')
      .filter({ has: page.locator('td:nth-child(2)') })
      .last();
    await row.getByRole('button', { name: 'Decide' }).click();
    const dialog = page.getByRole('dialog');

    // In scope: the implementation fields are there.
    await expect(dialog.getByLabel('Implementation note')).toBeVisible();

    await dialog.getByLabel('Status').selectOption('not_applicable');
    // Excluded: the justification hint changes to name the audit finding, and the fields that would
    // describe implementing something inapplicable go away.
    await expect(dialog.getByText(/An exclusion with no reason/i)).toBeVisible();
    await expect(dialog.getByLabel('Implementation note')).toBeHidden();
    // Still required — that is the whole point of a Statement of Applicability.
    await expect(dialog.getByLabel('Justification')).toHaveAttribute('required', '');
  });
});
