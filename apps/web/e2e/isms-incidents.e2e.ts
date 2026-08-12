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
 * Security incidents: the lifecycle, the timeline the transitions write, and the breach clock.
 *
 * WHAT THIS PINS THAT NOTHING ELSE CAN
 * ------------------------------------
 * - the state machine as a USER meets it: each state offers exactly the moves it allows, and the one it
 *   forbids is absent rather than offered-and-refused
 * - `false_positive` is unreachable after containment — containment is evidence it was real, and both the
 *   service and `ck_incident_false_positive` say so
 * - every status change appends to the timeline WITHOUT anybody logging it, because the transition writes
 *   the entry in its own transaction
 * - a personal-data breach carries a 72-hour deadline the API computes, and the row says which of three
 *   states it is in: not a breach, due, or notified
 *
 * Everything asserted here is created here — the register is shared with the API suites.
 */

function unique(prefix: string): string {
  return `${prefix}-${Date.now()}`;
}

/** A reported incident, through the API, so a spec can start from the state it needs. */
async function reportIncident(
  request: APIRequestContext,
  reference: string,
  options: { personalDataBreach?: boolean; detectedAt?: string } = {},
): Promise<{ id: string; reference: string }> {
  const res = await request.post('/v1/incidents/report', {
    headers: await csrfHeaders(request),
    data: {
      reference,
      title: `Playwright incident ${reference}`,
      description: 'Created by an e2e spec so the register has something to handle.',
      category: 'Phishing',
      severity: 'high',
      detectedAt: options.detectedAt ?? new Date().toISOString(),
      personalDataBreach: options.personalDataBreach ?? false,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { data?: { id: string }; id?: string };
  return { id: body.data?.id ?? body.id!, reference };
}

test.describe('incidents', () => {
  test('reports an incident, and the breach checkbox names the clock it starts', async ({
    page,
  }) => {
    const reference = unique('PWI').toUpperCase();
    await gotoInShell(page, '/incidents');

    await page.getByRole('button', { name: /report an incident/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The 72 hours are NAMED in the form, because ticking this box is what starts them.
    await expect(dialog.getByText(/72-hour notification clock/i)).toBeVisible();

    await dialog.getByLabel('Reference').fill(reference);
    await dialog.getByLabel('Category').fill('Phishing');
    await dialog.getByLabel('Title').fill('Credential-harvesting email opened in Finance');
    await dialog
      .getByLabel('What happened')
      .fill('Two people entered credentials on a fake portal.');
    await dialog.getByLabel('Severity').selectOption('critical');
    // TWO HOURS AGO, in the browser's own zone. A future detection time is refused ("an incident cannot
    // be detected in the future"), which is right — and it is why this is computed rather than a literal:
    // any fixed date is either in the future today or drifts into the distant past.
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const localDateTime = new Date(twoHoursAgo.getTime() - twoHoursAgo.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
    await dialog.getByLabel('Detected at').fill(localDateTime);
    await dialog.getByRole('button', { name: /report incident/i }).click();
    await expect(dialog).toBeHidden();

    await expectRowSomewhere(page, reference);
    const row = page.locator('tbody tr', { hasText: reference });
    await expect(row).toContainText('Critical');
    await expect(row).toContainText('Reported');
    // Not a breach, and the column says so rather than leaving a blank that could mean "not yet decided".
    await expect(row).toContainText('No');
  });

  test('offers only the moves the state allows, and writes each one to the timeline', async ({
    page,
    request,
  }) => {
    const incident = await reportIncident(request, unique('PWL').toUpperCase());

    await gotoInShell(page, '/incidents');
    await expectRowSomewhere(page, incident.reference);
    const row = page.locator('tbody tr', { hasText: incident.reference });

    // REPORTED: triage or dismiss. Containing is two steps away and is not offered.
    await expect(row.getByRole('button', { name: 'Triage' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Dismiss' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Contain' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Resolve' })).toHaveCount(0);

    await row.getByRole('button', { name: 'Triage' }).click();
    let dialog = page.getByRole('dialog');
    await chooseFromPicker(page, dialog, 'Assign to', 'Admin');
    await dialog.getByRole('button', { name: /^Triage$/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('tbody tr', { hasText: incident.reference })).toContainText(
      'Triaged',
      {
        timeout: 15_000,
      },
    );

    // TRIAGED: contain or dismiss.
    const triaged = page.locator('tbody tr', { hasText: incident.reference });
    await expect(triaged.getByRole('button', { name: 'Contain' })).toBeVisible();
    await expect(triaged.getByRole('button', { name: 'Triage' })).toHaveCount(0);

    await triaged.getByRole('button', { name: 'Contain' }).click();
    dialog = page.getByRole('dialog');
    // Says what containment costs: the false-positive exit closes.
    await expect(dialog.getByText(/cannot be dismissed as a false positive/i)).toBeVisible();
    await dialog.getByRole('button', { name: /mark contained/i }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('tbody tr', { hasText: incident.reference })).toContainText(
      'Contained',
      { timeout: 15_000 },
    );

    // CONTAINED: resolve only — dismissing is gone, which is the rule this test exists for.
    const contained = page.locator('tbody tr', { hasText: incident.reference });
    await expect(contained.getByRole('button', { name: 'Resolve' })).toBeVisible();
    await expect(contained.getByRole('button', { name: 'Dismiss' })).toHaveCount(0);

    // THE TIMELINE WROTE ITSELF. Nobody logged those two moves; the transitions did, in their own
    // transactions, which is why a timeline cannot be missing a step the status claims happened.
    await contained.click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('heading', { name: 'Timeline' })).toBeVisible();
    await expect(drawer.getByText('Status change').first()).toBeVisible();
    await expect(await drawer.getByText('Status change').count()).toBeGreaterThanOrEqual(2);
  });

  test('a personal-data breach shows its deadline, then shows it was notified', async ({
    page,
    request,
  }) => {
    // Detected 80 hours ago, so the 72-hour deadline has already passed and the banner has something to
    // report. The DEADLINE ITSELF is the API's: `notificationDueAt` comes from `detectedAt`, and
    // `hoursOverdue` from the report — this spec asserts on them rather than recomputing either.
    const detectedAt = new Date(Date.now() - 80 * 60 * 60 * 1000).toISOString();
    const incident = await reportIncident(request, unique('PWB').toUpperCase(), {
      personalDataBreach: true,
      detectedAt,
    });

    await gotoInShell(page, '/incidents');

    // The overdue banner appears only when something IS overdue, and names the hours.
    const banner = page.getByText(/past the 72-hour notification deadline/i);
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/h overdue/).first()).toBeVisible();

    await expectRowSomewhere(page, incident.reference);
    const row = page.locator('tbody tr', { hasText: incident.reference });
    await expect(row).toContainText('Due');

    // Recording the notification is a confirmation, not a form: backdating a regulator notification is
    // not something to offer.
    await row.click();
    const drawer = page.getByRole('dialog');
    await drawer.getByRole('button', { name: /regulator notified/i }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm.getByText(/not something to record before/i)).toBeVisible();
    await confirm.getByRole('button', { name: /record notification/i }).click();

    await expect(page.locator('tbody tr', { hasText: incident.reference })).toContainText(
      'Notified',
      { timeout: 15_000 },
    );
  });

  test('dismissing needs a reason, and the report stays in the register', async ({
    page,
    request,
  }) => {
    const incident = await reportIncident(request, unique('PWF').toUpperCase());

    await gotoInShell(page, '/incidents');
    await expectRowSomewhere(page, incident.reference);
    await page
      .locator('tbody tr', { hasText: incident.reference })
      .getByRole('button', { name: 'Dismiss' })
      .click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/dismissing is not deleting/i)).toBeVisible();
    await expect(dialog.getByLabel(/why it was not an incident/i)).toHaveAttribute('required', '');
    await dialog
      .getByLabel(/why it was not an incident/i)
      .fill('Simulated phishing test run by the security team.');
    await dialog.getByRole('button', { name: /^Dismiss$/ }).click();
    await expect(dialog).toBeHidden();

    // Still there, as a false positive — the register keeps what was reported.
    await page
      .getByRole('radiogroup', { name: /status/i })
      .getByRole('radio', { name: 'False positive' })
      .click();
    await expectRowSomewhere(page, incident.reference);
    await expect(page.locator('tbody tr', { hasText: incident.reference })).toContainText(
      'False positive',
    );
  });
});
