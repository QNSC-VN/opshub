import { test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { csrfHeaders, expect, expectRowSomewhere, gotoInShell } from './support/fixtures';

/**
 * Training and competency — five tabs, and the full loop that makes them worth having.
 *
 * THE LOOP IS THE POINT. A course on its own proves nothing; what an audit asks is "does this position
 * require it, has this person done it, and is the evidence attached". So the long journey below creates a
 * course, requires it of a position, sees the gap that requirement opens, records the completion, watches
 * the gap close, and attaches a certificate to the record — through the UI, against the real API.
 *
 * Everything it asserts on, it creates. A fresh database has no courses at all (measured: `total: 0`),
 * which is exactly the state CI runs in.
 */

function unique(prefix: string): string {
  return `${prefix}-${Date.now()}`;
}

/** A tiny real PDF, so the MIME allow-list and the size check see what they expect. */
const PDF_BYTES = Buffer.from(
  '255044462d312e340a25c7ec8fa20a312030206f626a0a3c3c2f547970652f436174616c6f672f50616765732032203020523e3e0a656e646f626a0a747261696c65720a3c3c2f526f6f742031203020523e3e0a2525454f46',
  'hex',
);

async function createEmployee(request: APIRequestContext): Promise<{ id: string; name: string }> {
  const stamp = Date.now();
  const name = `Training Probe ${stamp}`;
  const res = await request.post('/v1/employees', {
    headers: await csrfHeaders(request),
    data: { email: `training.probe.${stamp}@opshub.local`, displayName: name },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { data?: { id: string }; id?: string };
  return { id: body.data?.id ?? body.id!, name };
}

async function createPosition(request: APIRequestContext): Promise<{ id: string; title: string }> {
  const stamp = Date.now();
  const title = `Training Role ${stamp}`;
  const res = await request.post('/v1/positions', {
    headers: await csrfHeaders(request),
    data: { code: `TRN-${stamp}`, title, department: 'Quality', headcount: 5 },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { data?: { id: string }; id?: string };
  return { id: body.data?.id ?? body.id!, title };
}

test.describe('training', () => {
  test('creates a course, then hides and shows it with the retired filter', async ({ page }) => {
    const code = unique('PWT').toUpperCase();
    await gotoInShell(page, '/training');
    await page.getByRole('tab', { name: 'Courses' }).click();

    await page.getByRole('button', { name: /new course/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Code').fill(code);
    await dialog.getByLabel('Title').fill('Playwright Safety Basics');
    await dialog.getByLabel('Category').fill('Compliance');
    await dialog.getByLabel('Validity (months)').fill('12');
    await dialog.getByRole('button', { name: /create course/i }).click();
    await expect(dialog).toBeHidden();

    await expectRowSomewhere(page, code);
    const row = page.locator('tbody tr', { hasText: code });
    // Validity is shown as the course states it, not as a date somebody computed.
    await expect(row).toContainText('12 months');
    await expect(row).toContainText('Available');

    // Retiring keeps the row's history but takes it out of the default view — the assertion that the
    // filter means something rather than being decoration.
    await row.getByRole('button', { name: `Retire Playwright Safety Basics` }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm.getByText(/existing records and certificates are kept/i)).toBeVisible();
    await confirm.getByRole('button', { name: /retire course/i }).click();

    await expect(page.locator('tbody tr', { hasText: code })).toHaveCount(0, { timeout: 10_000 });
    await page
      .getByRole('radiogroup', { name: /status/i })
      .getByRole('radio', { name: 'Incl. retired' })
      .click();
    await expectRowSomewhere(page, code);
    await expect(page.locator('tbody tr', { hasText: code })).toContainText('Retired');
  });

  test('requires a course of a position, records the completion, and closes the gap', async ({
    page,
    request,
  }) => {
    const employee = await createEmployee(request);
    const position = await createPosition(request);
    const courseCode = unique('PWG').toUpperCase();
    const courseTitle = `Playwright Gap Course ${Date.now()}`;

    // The employee has to HOLD the position for its requirements to apply to them — that is the whole
    // design of requirements attaching to a job rather than a person.
    const assigned = await request.post(`/v1/positions/${position.id}/assignments`, {
      headers: await csrfHeaders(request),
      data: { employeeId: employee.id, effectiveFrom: '2026-01-01' },
    });
    expect(assigned.status(), await assigned.text()).toBe(201);

    await gotoInShell(page, '/training');

    // ── The course ────────────────────────────────────────────────────────────
    await page.getByRole('tab', { name: 'Courses' }).click();
    await page.getByRole('button', { name: /new course/i }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Code').fill(courseCode);
    await dialog.getByLabel('Title').fill(courseTitle);
    await dialog.getByLabel('Category').fill('Compliance');
    await dialog.getByRole('button', { name: /create course/i }).click();
    await expect(dialog).toBeHidden();

    // ── The requirement ───────────────────────────────────────────────────────
    await page.getByRole('tab', { name: 'Requirements' }).click();
    // Nothing chosen says so, rather than showing an empty table that would read as "requires nothing".
    await expect(page.getByText(/choose a position to see what it requires/i)).toBeVisible();

    // The picker searches by NAME. This is the field that used to demand a pasted UUID.
    //
    // Located by its ACCESSIBLE NAME, not `.first()`: a native `<select>` also has role combobox, so
    // "the first combobox" silently means a different control the moment a tab grows a select.
    await page.getByRole('combobox', { name: 'Position' }).fill(position.title);
    await page.getByRole('option', { name: new RegExp(position.title) }).click();

    await page.getByRole('button', { name: /require a course/i }).click();
    dialog = page.getByRole('dialog');
    // The modal names the position, which it can only do because the picker reports the chosen option.
    await expect(dialog.getByRole('heading', { name: new RegExp(position.title) })).toBeVisible();
    await dialog.getByLabel('Course').fill(courseTitle);
    await page.getByRole('option', { name: new RegExp(courseCode) }).click();
    await dialog.getByRole('button', { name: /add requirement/i }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('tbody tr', { hasText: courseCode })).toContainText('Mandatory');

    // ── The gap it opens ──────────────────────────────────────────────────────
    await page.getByRole('tab', { name: 'Competency gaps' }).click();
    await page.getByRole('combobox', { name: 'Filter by employee' }).fill(employee.name);
    await page.getByRole('option', { name: new RegExp(employee.name) }).click();

    await expect(page.locator('tbody tr', { hasText: courseCode })).toBeVisible({
      timeout: 15_000,
    });
    // Never completed, so the report says never rather than showing an empty date cell.
    await expect(page.locator('tbody tr', { hasText: courseCode })).toContainText('Never');

    // ── The completion ────────────────────────────────────────────────────────
    await page.getByRole('tab', { name: 'Records' }).click();
    await page.getByRole('button', { name: /record completion/i }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Employee').fill(employee.name);
    await page.getByRole('option', { name: new RegExp(employee.name) }).click();
    await dialog.getByLabel('Course').fill(courseTitle);
    await page.getByRole('option', { name: new RegExp(courseCode) }).click();
    await dialog.getByLabel('Result').fill('Pass');
    await dialog.getByRole('button', { name: /record completion/i }).click();
    await expect(dialog).toBeHidden();

    const recordRow = page.locator('tbody tr', { hasText: courseTitle });
    await expect(recordRow).toBeVisible({ timeout: 15_000 });
    await expect(recordRow).toContainText('Not verified');

    // Verifying is a second person saying they saw the evidence, and it is stamped.
    await recordRow.getByRole('button', { name: 'Verify' }).click();
    await expect(page.locator('tbody tr', { hasText: courseTitle })).not.toContainText(
      'Not verified',
      { timeout: 15_000 },
    );

    // ── The gap it closes ─────────────────────────────────────────────────────
    await page.getByRole('tab', { name: 'Competency gaps' }).click();
    await page.getByRole('combobox', { name: 'Filter by employee' }).fill(employee.name);
    await page.getByRole('option', { name: new RegExp(employee.name) }).click();
    await expect(page.locator('tbody tr', { hasText: courseCode })).toHaveCount(0, {
      timeout: 15_000,
    });
  });

  test('attaches a certificate to a record, through the real upload path', async ({
    page,
    request,
  }) => {
    // This journey exists because the upload hook was BROKEN in every environment: it sent no CSRF
    // header, so presign answered 403 and all three existing upload surfaces were dead. Nothing caught
    // it, because no test had ever driven an upload end to end. This one does — presign, PUT to storage,
    // confirm — so the next regression fails here rather than in somebody's hands.
    const employee = await createEmployee(request);
    const stamp = Date.now();
    const course = await request.post('/v1/training/courses', {
      headers: await csrfHeaders(request),
      data: {
        code: `PWC-${stamp}`,
        title: `Playwright Cert Course ${stamp}`,
        category: 'Compliance',
      },
    });
    expect(course.status(), await course.text()).toBe(201);
    const courseBody = (await course.json()) as { data?: { id: string }; id?: string };
    const record = await request.post('/v1/training/records', {
      headers: await csrfHeaders(request),
      data: {
        employeeId: employee.id,
        courseId: courseBody.data?.id ?? courseBody.id!,
        completedOn: '2026-02-04',
      },
    });
    expect(record.status(), await record.text()).toBe(201);

    await gotoInShell(page, '/training');
    await page.getByRole('tab', { name: 'Records' }).click();
    await page.getByRole('combobox', { name: 'Filter by employee' }).fill(employee.name);
    await page.getByRole('option', { name: new RegExp(employee.name) }).click();

    const row = page.locator('tbody tr', { hasText: `Playwright Cert Course ${stamp}` });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('heading', { name: 'Certificates' })).toBeVisible();
    await expect(drawer.getByText('No certificate attached')).toBeVisible();

    await drawer
      .locator('input[type=file]')
      .setInputFiles({ name: 'certificate.pdf', mimeType: 'application/pdf', buffer: PDF_BYTES });

    // The filename appearing means confirm succeeded: the row is rendered from the API's list, not from
    // the local file handle.
    await expect(drawer.getByText('certificate.pdf')).toBeVisible({ timeout: 20_000 });
    await expect(drawer.getByRole('button', { name: /download certificate\.pdf/i })).toBeVisible();
  });
});
