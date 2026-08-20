import { test } from './support/test';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  SEAT_EMAILS,
  chooseFromPicker,
  contextAs,
  csrfHeaders,
  expect,
  expectRowSomewhere,
  gotoInShell,
} from './support/fixtures';

/**
 * The controlled-document library — ISO 27001/9001 §7.5 documented information.
 *
 * WHAT THIS PINS THAT NOTHING ELSE CAN
 * ------------------------------------
 * - a document is registered WITH version 1 as a draft, and nothing is in force until a version is published
 * - a published version is IMMUTABLE: the screen offers no edit on it, only a new draft
 * - a version in review offers nothing at all — the request engine owns it until the approvers decide
 * - publishing supersedes what it replaces, and only the version in force can be acknowledged
 * - acknowledging is idempotent, and it clears the reader's own outstanding list
 * - retiring is soft: the document leaves the library and comes back with `Include retired`
 */

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`.toUpperCase();
}

async function me(request: APIRequestContext): Promise<{ sub: string; email: string }> {
  const res = await request.get('/v1/auth/me');
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { sub: string; email: string };
}

interface Version {
  id: string;
  version: number;
  status: string;
  requestId: string | null;
}

async function versions(request: APIRequestContext, documentId: string): Promise<Version[]> {
  const res = await request.get(`/v1/documents/${documentId}/versions`);
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as Version[];
}

async function registerDocument(
  request: APIRequestContext,
  code: string,
): Promise<{ id: string; code: string }> {
  const res = await request.post('/v1/documents', {
    headers: await csrfHeaders(request),
    data: {
      code,
      title: `Playwright policy ${code}`,
      category: 'isms_policy',
      ownerId: (await me(request)).sub,
      body: 'Version 1: remote access requires MFA.',
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { data?: { id: string }; id?: string };
  return { id: body.data?.id ?? body.id!, code };
}

/**
 * Get a draft approved.
 *
 * THE AUTHOR CANNOT APPROVE THEIR OWN — the request engine enforces separation of duties — so this submits as
 * the primary seat and approves from a second one. That is also why the spec cannot do this half through the
 * UI: the approval lives in the inbox of somebody else.
 */
async function submitAndApprove(
  request: APIRequestContext,
  documentId: string,
  versionId: string,
): Promise<void> {
  const submitted = await request.post(`/v1/documents/versions/${versionId}/submit`, {
    headers: await csrfHeaders(request),
  });
  expect(submitted.ok(), await submitted.text()).toBe(true);

  const [version] = (await versions(request, documentId)).filter((v) => v.id === versionId);
  expect(version.requestId, 'submitting must create an engine request').toBeTruthy();

  /*
   * A DIFFERENT SEAT FROM THE CALLER'S. The suite round-robins four admin seats across workers, so a
   * hard-coded approver is the same person as the requester on one worker in four — and the engine refuses
   * with `REQUEST_SOD_VIOLATION`, which is correct behaviour and a broken test.
   */
  const mine = (await me(request)).email;
  const approverEmail = SEAT_EMAILS.find((email) => email !== mine)!;
  const approver = await contextAs(approverEmail);
  const approved = await approver.post(`/v1/requests/${version.requestId}/approve`, {
    headers: await csrfHeaders(approver),
    data: {},
  });
  expect(approved.ok(), await approved.text()).toBe(true);
  await approver.dispose();
}

/** Open the document's drawer, searching first so paging cannot hide the row. */
async function openDrawer(page: Page, code: string, title: string) {
  await page.getByRole('searchbox').fill(code);
  const row = page.locator('tbody tr', { hasText: code });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.locator('td').first().click();
  const drawer = page.getByRole('dialog', { name: new RegExp(title) });
  await expect(drawer).toBeVisible();
  return { row, drawer };
}

test.describe('controlled documents', () => {
  test('registers a document with its first draft, and nothing is in force yet', async ({
    page,
  }) => {
    const code = unique('PWDOC');
    await gotoInShell(page, '/documents');

    await page.getByRole('button', { name: /register a document/i }).click();
    const dialog = page.getByRole('dialog', { name: /register a controlled document/i });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/^Code/).fill(code);
    await dialog.getByLabel(/^Title/).fill(`Playwright policy ${code}`);
    await dialog.getByLabel(/^Category/).selectOption('isms_policy');
    await chooseFromPicker(page, dialog, 'Owner', 'Admin');
    await dialog.getByLabel(/^Body/).fill('Version 1: remote access requires MFA.');
    await dialog.getByRole('button', { name: /register document/i }).click();
    await expect(dialog).toBeHidden();

    await expectRowSomewhere(page, code);
    const { drawer } = await openDrawer(page, code, `Playwright policy ${code}`);

    // A document with no version is a dead end, so the service creates version 1 with it.
    await expect(drawer.getByRole('article', { name: 'Version 1' })).toBeVisible();
    // Scoped to the version card and exact: "Edit draft" and "New draft" both contain the word.
    const v1 = drawer.getByRole('article', { name: 'Version 1' });
    await expect(v1.getByText('Draft', { exact: true })).toBeVisible();
    // Registered is not published: the library says so rather than implying the text is in force.
    await expect(drawer.getByText(/Nothing published yet/i)).toBeVisible();
    // A draft can be edited and submitted; there is nothing to publish or acknowledge.
    await expect(drawer.getByRole('button', { name: /edit draft/i })).toBeVisible();
    await expect(drawer.getByRole('button', { name: /^Publish$/ })).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: /i have read this/i })).toHaveCount(0);
  });

  test('a submitted draft offers nothing until the approvers decide', async ({ page, request }) => {
    const doc = await registerDocument(request, unique('PWREV'));
    const [v1] = await versions(request, doc.id);

    await gotoInShell(page, '/documents');
    const { drawer } = await openDrawer(page, doc.code, `Playwright policy ${doc.code}`);

    await drawer.getByRole('button', { name: /submit for approval/i }).click();
    await expect(
      drawer.getByRole('article', { name: 'Version 1' }).getByText('In review', { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    // The engine owns it now, and the screen says so instead of offering an approve button of its own.
    await expect(drawer.getByText(/request engine owns it/i)).toBeVisible();
    await expect(drawer.getByRole('button', { name: /edit draft/i })).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: /submit for approval/i })).toHaveCount(0);

    expect(v1.status).toBe('draft');
  });

  test('publishes an approved version, and only that version can be acknowledged', async ({
    page,
    request,
  }) => {
    const doc = await registerDocument(request, unique('PWPUB'));
    const [v1] = await versions(request, doc.id);
    await submitAndApprove(request, doc.id, v1.id);

    await gotoInShell(page, '/documents');
    let { drawer } = await openDrawer(page, doc.code, `Playwright policy ${doc.code}`);

    // Approved, so publishing is the only move — and it is a different permission from drafting.
    await expect(
      drawer.getByRole('article', { name: 'Version 1' }).getByText('Approved', { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await drawer.getByRole('button', { name: /^Publish$/ }).click();

    const publish = page.getByRole('dialog', { name: /^Publish v1/ });
    await expect(publish).toContainText(/supersedes/i);
    await publish.getByRole('button', { name: /publish version/i }).click();
    await expect(publish).toBeHidden();

    // Scoped to the card: the drawer's Details list also carries an "In force" term.
    await expect(
      drawer.getByRole('article', { name: 'Version 1' }).getByText('In force', { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    // Published is immutable: the next change is a new draft, never an edit.
    await expect(drawer.getByRole('button', { name: /edit draft/i })).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: /new draft/i })).toBeVisible();

    // Acknowledging is self-scoped — no permission code — and idempotent.
    await drawer.getByRole('button', { name: /i have read this/i }).click();
    await expect(drawer.getByText(/1 acknowledgement/i)).toBeVisible({ timeout: 15_000 });
    await drawer.getByRole('button', { name: /i have read this/i }).click();
    await expect(drawer.getByText(/1 acknowledgement/i)).toBeVisible({ timeout: 15_000 });

    // And the reader's own outstanding list no longer asks for it.
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(page.getByText(doc.code, { exact: false }).first()).toBeVisible();
    const banner = page.getByText(/document\(s\) to acknowledge/i);
    if (await banner.count()) {
      await expect(page.locator('li', { hasText: doc.code })).toHaveCount(0);
    }

    ({ drawer } = await openDrawer(page, doc.code, `Playwright policy ${doc.code}`));
    // The body is readable on the same screen as the acknowledgement: a tick with no text to read is the
    // box-ticking the requirement exists to prevent.
    await drawer.getByRole('button', { name: /read text/i }).click();
    await expect(drawer.getByText(/remote access requires MFA/i)).toBeVisible();
  });

  test('retiring is soft: it leaves the library and comes back with the filter', async ({
    page,
    request,
  }) => {
    const doc = await registerDocument(request, unique('PWRET'));

    await gotoInShell(page, '/documents');
    await page.getByRole('searchbox').fill(doc.code);
    const row = page.locator('tbody tr', { hasText: doc.code });
    await expect(row).toBeVisible({ timeout: 15_000 });

    await row.getByRole('button', { name: 'Retire' }).click();
    const confirm = page.getByRole('alertdialog');
    // Soft, and the dialog says why: a control that cited it still has to be explainable.
    await expect(confirm).toContainText(/history stays readable/i);
    await confirm.getByRole('button', { name: /retire document/i }).click();

    await expect(page.locator('tbody tr', { hasText: doc.code })).toHaveCount(0, {
      timeout: 15_000,
    });

    await page.getByRole('button', { name: /include retired/i }).click();
    await expect(page.locator('tbody tr', { hasText: doc.code })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('tbody tr', { hasText: doc.code })).toContainText('Retired');
  });
});
