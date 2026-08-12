import { test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import {
  chooseFromPicker,
  csrfHeaders,
  expect,
  expectRowSomewhere,
  gotoInShell,
} from './support/fixtures';

/**
 * The information-asset register and the supplier register — the two ISMS screens whose rules live in
 * REFERENCE DATA rather than in code.
 *
 * WHAT THIS PINS THAT NOTHING ELSE CAN
 * ------------------------------------
 * - a classification's handling rules and encryption requirement come from the API's own level table and
 *   are shown where the choice is made, so a policy edit lands in the form
 * - LOWERING a classification is a different act from raising it: a different endpoint, a different
 *   permission (`information_asset.declassify`), and the dialog says which one it is about to do
 * - every classification change is appended with its reason, so the register answers "when did this become
 *   restricted and who said so"
 * - a supplier is registered PROSPECTIVE and activating it needs `vendor.approve`, not `vendor.manage`
 * - `pass_with_conditions` demands its conditions, because a conditional pass with nothing written down is
 *   just a pass
 */

function unique(prefix: string): string {
  return `${prefix}-${Date.now()}`;
}

async function myEmployeeId(request: APIRequestContext): Promise<string> {
  const me = await request.get('/v1/auth/me');
  expect(me.ok(), await me.text()).toBe(true);
  return ((await me.json()) as { sub: string }).sub;
}

/** An asset at a chosen classification, through the API. */
async function registerAsset(
  request: APIRequestContext,
  reference: string,
  classification: 'public' | 'internal' | 'confidential' | 'restricted',
  /**
   * THE LABEL HAS TO MATCH THE ASSESSMENT. The API refuses a `restricted` asset whose confidentiality
   * rating is below 4 — "the label was applied without the assessment agreeing" — which is the rule this
   * spec learned by breaking it. Passed in so a test that will reclassify UPWARDS starts with a rating
   * that supports the destination.
   */
  confidentiality = 3,
): Promise<{ id: string; reference: string }> {
  const ownerId = await myEmployeeId(request);
  const res = await request.post('/v1/information-assets', {
    headers: await csrfHeaders(request),
    data: {
      reference,
      name: `Playwright asset ${reference}`,
      type: 'dataset',
      classification,
      classificationReason: 'Created by an e2e spec.',
      ownerId,
      confidentiality,
      integrity: 3,
      availability: 3,
      personalData: true,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { data?: { id: string }; id?: string };
  return { id: body.data?.id ?? body.id!, reference };
}

test.describe('information assets', () => {
  test('registers an asset, showing the handling rules the level carries', async ({ page }) => {
    const reference = unique('PWA').toUpperCase();
    await gotoInShell(page, '/information-assets');

    await page.getByRole('button', { name: /register an asset/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Reference').fill(reference);
    // ANCHORED LABELS. `FormField` appends `*` to a required field's accessible name, and plain substring
    // matching then finds more than one control: "Classification" also matches "Why this classification".
    await dialog.getByLabel(/^Name/).fill('Customer billing extract');
    await dialog.getByLabel(/^Classification/).selectOption('restricted');
    // THE POLICY'S OWN WORDS, from `/classification-levels` — not a string in this codebase. Restricted
    // requires encryption, and the form says so where the choice is made.
    await expect(dialog.getByText(/Encryption required/i)).toBeVisible();

    await dialog.getByLabel('Why this classification').fill('Contains cardholder data.');
    // `restricted` requires a confidentiality rating of at least 4: the classification is a claim the
    // assessment has to support, and the API refuses the pair when it does not.
    await dialog.getByLabel(/^Confidentiality/).selectOption('5');
    await chooseFromPicker(page, dialog, 'Owner', 'Admin');
    await dialog.getByRole('button', { name: /register asset/i }).click();
    await expect(dialog).toBeHidden();

    await expectRowSomewhere(page, reference);
    const row = page.locator('tbody tr', { hasText: reference });
    await expect(row).toContainText('Restricted');
    // The encryption flag travels with the classification, so the row shows it too.
    await expect(row).toContainText('encrypted');
    // Zero devices is a number, not a blank: nothing registered holds it yet.
    await expect(row).toContainText('0');
  });

  test('declassifying is a different act from reclassifying, and both are recorded', async ({
    page,
    request,
  }) => {
    const asset = await registerAsset(request, unique('PWD').toUpperCase(), 'confidential', 5);

    await gotoInShell(page, '/information-assets');
    await page.getByRole('searchbox').fill(asset.reference);
    const row = page.locator('tbody tr', { hasText: asset.reference });
    await expect(row).toBeVisible({ timeout: 15_000 });

    // UP first: the dialog offers to reclassify, in the ordinary way.
    await row.getByRole('button', { name: 'Reclassify' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('New classification').selectOption('restricted');
    await expect(dialog.getByRole('button', { name: /^Reclassify$/ })).toBeVisible();
    await dialog.getByLabel('Reason').fill('Scope now includes payment identifiers.');
    await dialog.getByRole('button', { name: /^Reclassify$/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('tbody tr', { hasText: asset.reference })).toContainText(
      'Restricted',
      {
        timeout: 15_000,
      },
    );

    // DOWN second: same form, and it changes what it says it will do — because lowering a classification
    // removes protection and goes to the declassify endpoint under its own permission.
    await page
      .locator('tbody tr', { hasText: asset.reference })
      .getByRole('button', { name: 'Reclassify' })
      .click();
    dialog = page.getByRole('dialog');
    // Down to CONFIDENTIAL, not internal: the asset holds personal data, and the API refuses
    // "personal data cannot be classified 'internal' — it must be at least 'confidential'". Another rule
    // this spec learned by breaking it, and the right one to respect rather than route around.
    await dialog.getByLabel('New classification').selectOption('confidential');
    await expect(dialog.getByText(/LOWERING a classification removes protection/i)).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Declassify$/ })).toBeVisible();
    await dialog.getByLabel('Reason').fill('Payment identifiers removed from the extract.');
    await dialog.getByRole('button', { name: /^Declassify$/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('tbody tr', { hasText: asset.reference })).toContainText(
      'Confidential',
      { timeout: 15_000 },
    );

    // BOTH CHANGES ARE IN THE HISTORY, with the registration before them. That is the audit answer: not
    // what it is classified as, but when it became that and why.
    await page.locator('tbody tr', { hasText: asset.reference }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('heading', { name: 'Classification history' })).toBeVisible();
    await expect(drawer.getByText('registered as')).toBeVisible();
    await expect(drawer.getByText(/Payment identifiers removed/)).toBeVisible();
    await expect(drawer.getByText(/Scope now includes payment identifiers/)).toBeVisible();
  });
});

test.describe('suppliers', () => {
  test('registers a supplier as prospective, then activates it', async ({ page }) => {
    const reference = unique('PWS').toUpperCase();
    await gotoInShell(page, '/vendors');

    await page.getByRole('button', { name: /register a supplier/i }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/Registered as PROSPECTIVE/i)).toBeVisible();

    await dialog.getByLabel('Reference').fill(reference);
    await dialog.getByLabel('Criticality').selectOption('critical');
    // CRITICALITY IS A SCHEDULE, and the level's own interval is shown when it is chosen.
    await expect(dialog.getByText(/Reassessed every \d+ months/)).toBeVisible();
    await dialog.getByLabel(/^Name/).fill('Acme Cloud');
    await dialog.getByLabel('Services').fill('Hosting for the billing platform.');
    await chooseFromPicker(page, dialog, 'Owner', 'Admin');
    await dialog.getByRole('button', { name: /register supplier/i }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('searchbox').fill(reference);
    const row = page.locator('tbody tr', { hasText: reference });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText('Prospective');
    // Never assessed is named rather than blank — it is what the review-gap report is about.
    await expect(row).toContainText('Never');
    // AND THEREFORE NO ACTIVATE BUTTON. The API refuses activation for an unassessed supplier
    // (`VENDOR_ASSESSMENT_REQUIRED`), so the screen offers the assessment instead of an action that can
    // only fail. This assertion is the gate; the rest of the test walks through it.
    await expect(row.getByRole('button', { name: 'Activate' })).toHaveCount(0);

    await row.getByRole('button', { name: 'Assess' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Scope').fill('ISO 27001 certificate and the hosting DPA.');
    await dialog.getByRole('button', { name: /record assessment/i }).click();
    await expect(dialog).toBeHidden();

    // Activating is `vendor.approve`, and it is a confirmation because it accepts the dependency.
    await expect(
      page.locator('tbody tr', { hasText: reference }).getByRole('button', { name: 'Activate' }),
    ).toBeVisible({ timeout: 15_000 });
    await page
      .locator('tbody tr', { hasText: reference })
      .getByRole('button', { name: 'Activate' })
      .click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm.getByText(/Accepts the dependency/i)).toBeVisible();
    await confirm.getByRole('button', { name: /^Activate$/ }).click();
    await expect(page.locator('tbody tr', { hasText: reference })).toContainText('Active', {
      timeout: 15_000,
    });
  });

  test('a conditional pass demands its conditions', async ({ page, request }) => {
    // `pass_with_conditions` exists so that a pass which owes something is not recorded as a clean pass.
    // The conditions field appears WITH that outcome and is required, because the conditions are the
    // difference between the two.
    const reference = unique('PWV').toUpperCase();
    const ownerId = await myEmployeeId(request);
    const created = await request.post('/v1/vendors', {
      headers: await csrfHeaders(request),
      data: {
        reference,
        name: `Playwright supplier ${reference}`,
        services: 'Created by an e2e spec.',
        criticality: 'high',
        ownerId,
      },
    });
    expect(created.status(), await created.text()).toBe(201);

    await gotoInShell(page, '/vendors');
    await page.getByRole('searchbox').fill(reference);
    const row = page.locator('tbody tr', { hasText: reference });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole('button', { name: 'Assess' }).click();

    const dialog = page.getByRole('dialog');
    // A high-criticality supplier needs INDEPENDENT evidence, and that comes from the level table.
    await expect(dialog.getByText(/INDEPENDENT evidence/i)).toBeVisible();

    // A plain pass has no conditions field at all.
    await expect(dialog.getByLabel('Conditions')).toHaveCount(0);

    await dialog.getByLabel('Outcome').selectOption('pass_with_conditions');
    await expect(dialog.getByLabel('Conditions')).toBeVisible();
    await expect(dialog.getByLabel('Conditions')).toHaveAttribute('required', '');

    await dialog.getByLabel('Scope').fill('SOC 2 Type II report for the hosting platform.');
    await dialog
      .getByLabel('Conditions')
      .fill('Provide the penetration-test summary within 30 days.');
    await dialog.getByRole('button', { name: /record assessment/i }).click();
    await expect(dialog).toBeHidden();

    await expect(page.locator('tbody tr', { hasText: reference })).toContainText(
      'Pass with conditions',
      { timeout: 15_000 },
    );

    // The conditions are on the assessment, where the next person looks for them.
    await page.locator('tbody tr', { hasText: reference }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('heading', { name: 'Assessments' })).toBeVisible();
    await expect(
      drawer.getByText(/Conditions: Provide the penetration-test summary/),
    ).toBeVisible();
  });
});
