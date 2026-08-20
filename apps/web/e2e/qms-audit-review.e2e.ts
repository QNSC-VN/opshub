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
 * The internal-audit programme and the §9.3 management review — the last two QMS screens, and the ones whose
 * rules are about ORDER and about EVIDENCE rather than about a single row.
 *
 * WHAT THIS PINS THAT NOTHING ELSE CAN
 * ------------------------------------
 * - an audit cannot be closed straight from fieldwork: Close appears only once results are reported, and
 *   reporting needs both a conclusion and a report document
 * - the lead auditor is on the roster from the moment the audit exists, which is what makes the impartiality
 *   rule enforceable, and the roster panel says what being on it costs somebody
 * - a review's agenda is LIVE while scheduled and FROZEN once held — the numbers the minutes were written
 *   against, which is the whole reason holding is its own step
 * - outputs can only be raised while a review is `held`: not before the meeting, not after the minutes
 * - closing a review needs a conclusion AND its minutes document, and a closed review offers no more outputs
 */

function unique(prefix: string): string {
  return `${prefix}-${Date.now()}`.toUpperCase();
}

async function myEmployeeId(request: APIRequestContext): Promise<string> {
  const me = await request.get('/v1/auth/me');
  expect(me.ok(), await me.text()).toBe(true);
  return ((await me.json()) as { sub: string }).sub;
}

/**
 * A controlled document to cite.
 *
 * Reporting an audit and closing a review both require one — results nobody can read are not results — so
 * the spec creates its own rather than depending on a seeded library it does not control.
 */
async function createDocument(request: APIRequestContext, code: string): Promise<string> {
  const res = await request.post('/v1/documents', {
    headers: await csrfHeaders(request),
    data: {
      code,
      title: `Playwright document ${code}`,
      category: 'qms_procedure',
      ownerId: await myEmployeeId(request),
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { data?: { id: string }; id?: string };
  return body.data?.id ?? body.id!;
}

async function planAudit(
  request: APIRequestContext,
  reference: string,
): Promise<{ id: string; reference: string }> {
  const res = await request.post('/v1/internal-audits', {
    headers: await csrfHeaders(request),
    data: {
      reference,
      title: `Playwright audit ${reference}`,
      objective: 'Confirm approvals are recorded for every release.',
      scope: 'Software delivery, current quarter.',
      criteria: 'ISO 9001:2015 §8.5.6',
      leadAuditorId: await myEmployeeId(request),
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { data?: { id: string }; id?: string };
  return { id: body.data?.id ?? body.id!, reference };
}

async function startAudit(request: APIRequestContext, id: string): Promise<void> {
  const res = await request.post(`/v1/internal-audits/${id}/start`, {
    headers: await csrfHeaders(request),
    data: {},
  });
  expect(res.ok(), await res.text()).toBe(true);
}

/**
 * A review scheduled far enough in the past that nothing is scheduled before it.
 *
 * REVIEWS ARE HELD IN ORDER — the API refuses to hold one while a review scheduled earlier is still
 * outstanding (§9.3.2(a) asks THIS review about actions from PREVIOUS ones). A spec that scheduled its review
 * for next month would be refused by whatever else the database happens to hold, so it takes the earliest
 * slot instead: strictly earlier by date, and a reference that sorts low for the same-day tie-break.
 */
async function scheduleReview(
  request: APIRequestContext,
  reference: string,
): Promise<{ id: string; reference: string }> {
  const res = await request.post('/v1/management-reviews', {
    headers: await csrfHeaders(request),
    data: {
      reference,
      title: `Playwright review ${reference}`,
      period: '2019 Q1',
      chairId: await myEmployeeId(request),
      scheduledFor: '2019-01-02',
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { data?: { id: string }; id?: string };
  return { id: body.data?.id ?? body.id!, reference };
}

/** Open a drawer from a register, searching first so paging cannot hide the row. */
async function openDrawer(page: Page, reference: string, title = reference) {
  await page.getByRole('searchbox').fill(reference);
  const row = page.locator('tbody tr', { hasText: reference });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.locator('td').first().click();
  /*
   * BY NAME, because a modal opened from the drawer renders INSIDE it and a text filter matches both.
   * The drawer is named by its TITLE — the audit or review's own title, not its reference — so a caller
   * whose title does not quote the reference passes it explicitly.
   */
  const drawer = page.getByRole('dialog', { name: new RegExp(title) });
  await expect(drawer).toBeVisible();
  return { row, drawer };
}

test.describe('internal audits', () => {
  test('plans an audit, and the lead is on the roster from the start', async ({ page }) => {
    const reference = unique('PWIA');
    await gotoInShell(page, '/internal-audits');

    await page.getByRole('button', { name: /plan an audit/i }).click();
    const dialog = page.getByRole('dialog', { name: /plan an internal audit/i });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/^Reference/).fill(reference);
    await dialog.getByLabel(/^Title/).fill('Change management, Q3');
    await dialog.getByLabel(/^Objective/).fill('Confirm approvals are recorded for every release.');
    await dialog.getByLabel(/^Scope/).fill('Software delivery, current quarter.');
    await dialog.getByLabel(/^Criteria/).fill('ISO 9001:2015 §8.5.6');
    await chooseFromPicker(page, dialog, 'Lead auditor', 'Admin');
    await dialog.getByRole('button', { name: /plan audit/i }).click();
    await expect(dialog).toBeHidden();

    await expectRowSomewhere(page, reference);
    const row = page.locator('tbody tr', { hasText: reference });
    await expect(row).toContainText('Planned');
    // ONE, not none: the lead joins the roster in the same transaction, which is what makes the
    // impartiality rule enforceable — and what lets fieldwork start at all.
    await expect(row).toContainText('1');
    await expect(row.getByRole('button', { name: 'Start' })).toBeVisible();

    const { drawer } = await openDrawer(page, reference, 'Change management, Q3');
    // `.first()`: the roster row's badge. The role picker below it offers the same word as an option.
    await expect(drawer.getByText('Lead', { exact: true }).first()).toBeVisible();
    // The roster's cost is stated where people are added to it, not discovered later at a refusal.
    await expect(drawer.getByText(/barred from certifying a fix/i)).toBeVisible();
  });

  test('closes only through reporting, and reporting needs a conclusion and a report', async ({
    page,
    request,
  }) => {
    const audit = await planAudit(request, unique('PWIAR'));
    await startAudit(request, audit.id);
    const code = unique('PWDOC').replace(/[^A-Z0-9-]/g, '-');
    await createDocument(request, code);

    await gotoInShell(page, '/internal-audits');
    await page.getByRole('searchbox').fill(audit.reference);
    const row = page.locator('tbody tr', { hasText: audit.reference });
    await expect(row).toBeVisible({ timeout: 15_000 });

    // FIELDWORK: report is the only forward move. `in_progress → closed` is refused by the service and by
    // `ck_audit_reported_pair`, so offering Close here would be offering a refusal.
    await expect(row.getByRole('button', { name: 'Report' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Close' })).toHaveCount(0);

    await row.getByRole('button', { name: 'Report' }).click();
    const dialog = page.getByRole('dialog', { name: /^Report / });
    await dialog.getByLabel(/^Conclusion/).fill('Two of eleven releases had no recorded approval.');
    await chooseFromPicker(page, dialog, 'Report document', code);
    await dialog.getByRole('button', { name: /report results/i }).click();
    await expect(dialog).toBeHidden();

    await expect(page.locator('tbody tr', { hasText: audit.reference })).toContainText('Reported', {
      timeout: 15_000,
    });

    // Only NOW is Close offered — and it takes no form, because the conclusion and report are already on
    // the row. So a confirmation, and the audit is settled.
    await page
      .locator('tbody tr', { hasText: audit.reference })
      .getByRole('button', { name: 'Close' })
      .click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText(/accepts nothing further/i);
    await confirm.getByRole('button', { name: /close audit/i }).click();

    await expect(page.locator('tbody tr', { hasText: audit.reference })).toContainText('Closed', {
      timeout: 15_000,
    });
  });
});

test.describe('management reviews', () => {
  test('the agenda is live while scheduled and frozen once held', async ({ page, request }) => {
    // `A-` so the same-day tie-break puts nothing before it: reviews are held in order.
    const review = await scheduleReview(request, `A-${unique('PWMR')}`);

    await gotoInShell(page, '/management-reviews');
    // ONE drawer, worked in place. The drawer is modal, so its overlay covers the row it was opened from —
    // and it re-reads the review from the register, which is exactly what the frozen/live switch tests.
    const { row, drawer } = await openDrawer(page, review.reference);

    // LIVE: composed from the other registers, and it says so. Every §9.3.2 input is named with its clause,
    // so the agenda reads as the standard's list rather than as a dashboard.
    await expect(drawer.getByText(/Live as at/i)).toBeVisible({ timeout: 15_000 });
    await expect(drawer.getByText('§9.3.2(a)')).toBeVisible();
    await expect(drawer.getByText('Untreated risks')).toBeVisible();
    // Before the meeting there is nothing for an output to be an output OF.
    await expect(drawer.getByRole('button', { name: /raise an output/i })).toHaveCount(0);

    await drawer.getByRole('button', { name: /record as held/i }).click();
    const dialog = page.getByRole('dialog', { name: /^Hold / });
    await expect(dialog).toContainText(/FREEZES its inputs/i);
    await dialog.getByRole('button', { name: /record as held/i }).click();
    await expect(dialog).toBeHidden();

    await expect(row).toContainText('Held', { timeout: 15_000 });
    // FROZEN: the same endpoint, a different answer — the numbers the minutes were written against.
    await expect(drawer.getByText(/Frozen as at/i)).toBeVisible({ timeout: 15_000 });
    // Held, so cancelling is gone: the inputs are frozen and the actions are about to be raised.
    await expect(row.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: /raise an output/i })).toBeVisible();
  });

  test('records an output, works it, and closes on minutes', async ({ page, request }) => {
    const review = await scheduleReview(request, `A-${unique('PWMRO')}`);
    const code = unique('PWMIN').replace(/[^A-Z0-9-]/g, '-');
    await createDocument(request, code);

    await gotoInShell(page, '/management-reviews');
    const { row, drawer } = await openDrawer(page, review.reference);
    await drawer.getByRole('button', { name: /record as held/i }).click();
    let dialog = page.getByRole('dialog', { name: /^Hold / });
    await dialog.getByRole('button', { name: /record as held/i }).click();
    await expect(dialog).toBeHidden();

    // A held review with no outputs says so as a WARNING: §9.3.3 expects decisions.
    await expect(drawer.getByText(/a review that decided nothing/i)).toBeVisible();

    await drawer.getByRole('button', { name: /raise an output/i }).click();
    dialog = page.getByRole('dialog', { name: /raise an output/i });
    await dialog.getByLabel(/^Category/).selectOption('resource_need');
    await dialog.getByLabel(/^Description/).fill('Fund a second release engineer.');
    await chooseFromPicker(page, dialog, 'Owner', 'Admin');
    await dialog.getByRole('button', { name: /raise action/i }).click();
    await expect(dialog).toBeHidden();

    await expect(drawer.getByText('Resource need')).toBeVisible({ timeout: 15_000 });
    await drawer.getByRole('button', { name: /^Start$/ }).click();
    await expect(drawer.getByText('In progress')).toBeVisible({ timeout: 15_000 });

    await drawer.getByRole('button', { name: /^Complete$/ }).click();
    dialog = page.getByRole('dialog', { name: /complete this action/i });
    await dialog.getByLabel(/^Outcome note/).fill('Headcount approved for the next quarter.');
    await dialog.getByRole('button', { name: /complete action/i }).click();
    await expect(dialog).toBeHidden();

    await expect(drawer.getByText('Completed')).toBeVisible({ timeout: 15_000 });

    // CLOSING NEEDS BOTH: §9.3.3 asks for documented outputs, and a conclusion nobody can read is not
    // documentation. Driven from the ROW after dismissing the drawer: the drawer's agenda is live while
    // other work lands in the registers it counts, so its header shifts under a click.
    // Escape, which only works because closing the outcome modal put focus back INSIDE the drawer: the
    // button that opened it had been removed by then, and focus used to land on `<body>`.
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await row.getByRole('button', { name: 'Close' }).click();
    dialog = page.getByRole('dialog', { name: /^Close / });
    await dialog
      .getByLabel(/^Conclusion/)
      .fill('The system remains effective; one resource gap closed.');
    await chooseFromPicker(page, dialog, 'Minutes document', code);
    await dialog.getByRole('button', { name: /close review/i }).click();
    await expect(dialog).toBeHidden();

    await expect(row).toContainText('Closed', { timeout: 15_000 });

    // A closed review accepts no new outputs: an action added after the minutes are issued is an output
    // those minutes do not contain.
    await row.locator('td').first().click();
    await expect(drawer.getByRole('button', { name: /raise an output/i })).toHaveCount(0);
    await expect(drawer.getByText('Completed')).toBeVisible({ timeout: 15_000 });
  });
});
