import { test } from '@playwright/test';
import { clickFirstRow, expect, gotoInShell } from './support/fixtures';

/**
 * The people directory, in depth — the second-largest screen, and the one that carried a 1081-line
 * file until it was decomposed.
 *
 * WHAT THIS PINS THAT UNIT TESTS CANNOT
 * -------------------------------------
 * The shell spec proves `/people` mounts. It does not prove the table has rows, that the search box
 * reaches the API, that the dialog is a dialog, or that the onboarding wizard's option cards are
 * selectable — and those last two were genuine defects before this conversion: the cards were
 * `<button>`s with a colour, so nothing announced which device type was chosen.
 *
 * Creates its own employee, because a spec that depends on seed data it did not write passes for a
 * reason it cannot state (learned on the compliance journey, where CI's catalogue was empty).
 */

/** Unique per run: the database is shared and never reset between Playwright runs. */
function uniqueEmployee(): { name: string; email: string } {
  const stamp = Date.now();
  return { name: `Playwright Person ${stamp}`, email: `playwright.${stamp}@opshub.local` };
}

test.describe('people', () => {
  test('creates an employee through a real dialog and finds it by search', async ({ page }) => {
    const { name, email } = uniqueEmployee();
    await gotoInShell(page, '/people');

    await page.getByRole('button', { name: /add employee/i }).click();

    // A DIALOG, not a bare overlay: `Modal` is the only thing that sets `role="dialog"`, traps focus
    // and closes on Escape. Scoping the fields to it also means a stray input elsewhere on the page
    // cannot be filled by mistake.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/email/i).fill(email);
    await dialog.getByLabel(/display name/i).fill(name);
    await dialog.getByLabel(/department/i).fill('Playwright');
    await dialog.getByRole('button', { name: 'Create' }).click();

    // The dialog closing is part of the flow — a form that submits and stays open reads as a failure.
    await expect(dialog).toBeHidden();

    // Found by SEARCH, which proves the term reached the API rather than filtering a cached page.
    await page.getByRole('searchbox').fill(name);
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
  });

  test('opens the detail drawer with the record, not an empty shell', async ({ page }) => {
    await gotoInShell(page, '/people');

    // The seeded directory always has rows; the row this clicks is whichever is first.
    const firstRow = page
      .locator('tbody tr')
      .filter({ has: page.locator('td:nth-child(2)') })
      .first();
    const name = await firstRow.locator('td').first().innerText();
    await clickFirstRow(page);

    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    // The section HEADING, not any text reading "Details" — the drawer's aria description repeats it,
    // so a text match finds two and Playwright's strict mode rightly refuses to guess.
    await expect(drawer.getByRole('heading', { name: 'Details' })).toBeVisible();
    // A field from the details list, proving it rendered the record rather than an empty shell.
    await expect(drawer.getByText('Email')).toBeVisible();
    // The name from the row is the drawer's title, so it is showing THAT record.
    expect(name).toContain((await drawer.getByRole('heading').first().innerText()).trim());
  });

  test('the onboarding wizard advances, and its option cards are real radios', async ({ page }) => {
    await gotoInShell(page, '/people');

    // Onboarding is offered per row, by an icon button — which now has an accessible name, where
    // before there were three unnamed icon buttons per row.
    await page
      .getByRole('button', { name: /^Onboard / })
      .first()
      .click();

    const wizard = page.getByRole('dialog');
    await expect(wizard).toBeVisible();

    // Step 0 refuses to advance without the start date, and says so.
    await wizard.getByRole('button', { name: 'Next' }).click();
    await expect(wizard.getByRole('alert')).toContainText(/start date/i);

    await wizard.getByLabel(/start date/i).fill('2030-06-03');
    await wizard.getByRole('button', { name: 'Next' }).click();

    // Step 1: the device cards are RADIOS now, so they have a checked state to assert — the
    // `<button>` version had none.
    //
    // Clicked by their LABEL, which is both the user's path and the only one available: the input is
    // `sr-only`, so it has no clickable box and `check()` waits forever for one. The card look lives
    // on the label; the input carries the semantics.
    await wizard.getByText('Desktop', { exact: true }).click();
    await expect(wizard.getByRole('radio', { name: /Desktop/ })).toBeChecked();
    // And it is a GROUP: choosing one clears the other, which is what `name=` on a radio buys.
    await expect(wizard.getByRole('radio', { name: /Laptop/ })).not.toBeChecked();

    // The OS row is the shared segmented control — a named radiogroup.
    const os = wizard.getByRole('radiogroup', { name: /operating system/i });
    await os.getByRole('radio', { name: 'macOS' }).click();
    await expect(os.getByRole('radio', { name: 'macOS' })).toHaveAttribute('aria-checked', 'true');

    await wizard.getByRole('button', { name: 'Next' }).click();

    // Step 2: access needs are real checkboxes, so they toggle and report state. Clicked by label for
    // the same reason as the radios.
    await wizard.getByText('VPN', { exact: true }).click();
    await expect(wizard.getByRole('checkbox', { name: 'VPN' })).toBeChecked();

    await wizard.getByRole('button', { name: 'Next' }).click();

    // Step 3 reviews what was chosen — the values, not the form.
    await expect(wizard.getByText('3 Jun 2030')).toBeVisible();
    await expect(wizard.getByText('Desktop')).toBeVisible();
    await expect(wizard.getByText('macOS')).toBeVisible();
    await expect(wizard.getByText('VPN')).toBeVisible();

    // Left without submitting: this spec asserts the wizard, and an onboarding request would start a
    // three-step approval chain in a shared database.
    await page.keyboard.press('Escape');
  });

  test('uploads an employee photo, all three steps of it', async ({ page }) => {
    // THE UPLOAD PATH WAS DEAD IN EVERY ENVIRONMENT. `useUpload` sent no CSRF header, so presign
    // answered `403 FORBIDDEN: Invalid csrf token` and this widget could not attach anything — and the
    // bucket's CORS allow-list omitted `Content-Disposition`, which the presign SIGNS, so even a
    // CSRF-correct PUT died as an opaque `net::ERR_FAILED`. Two separate faults, neither visible to any
    // test, because no test had ever driven an upload.
    //
    // A 1×1 PNG is enough: this asserts the three-step handshake, not image handling.
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    );

    await gotoInShell(page, '/people');
    await clickFirstRow(page);
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();

    // WAITS ON THE THREE RESPONSES, not on the preview. The preview is drawn from the local file by
    // `FileReader` before anything is sent, and "no error yet" is true a millisecond after the click —
    // so both would pass against the broken version this test exists to catch. The PUT is the step that
    // CORS killed and the confirm is the step CSRF killed; asserting all three is the only honest proof.
    const presign = page.waitForResponse((r) => r.url().includes('/avatar/presign') && r.ok());
    const put = page.waitForResponse((r) => r.request().method() === 'PUT' && r.ok());
    const confirm = page.waitForResponse((r) => r.url().includes('/avatar/confirm') && r.ok());

    await drawer
      .locator('input[type=file]')
      .setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });

    await presign;
    await put;
    await confirm;
    await expect(drawer.locator('.text-danger')).toHaveCount(0);
    await expect(drawer.locator('img[alt="Preview"]')).toBeVisible();

    // TWICE, because REPLACING was its own defect: `confirmAvatar` looked the previous file up by KEY
    // through a by-id finder, so the second upload for any employee answered 500 while the first
    // succeeded. One upload proves the handshake; two prove the replacement path.
    const secondConfirm = page.waitForResponse(
      (r) => r.url().includes('/avatar/confirm') && r.ok(),
    );
    await drawer
      .locator('input[type=file]')
      .setInputFiles({ name: 'photo-2.png', mimeType: 'image/png', buffer: PNG });
    await secondConfirm;
    await expect(drawer.locator('.text-danger')).toHaveCount(0);
  });
});
