import { test } from './support/test';
import {
  SEAT_EMAILS,
  contextAs,
  createAccessRequest,
  csrfHeaders,
  expect,
  gotoInShell,
} from './support/fixtures';

/**
 * The privileged access a person currently HOLDS, as opposed to the access they are asking for.
 *
 * WHAT THIS PINS THAT NOTHING ELSE CAN
 * ------------------------------------
 * - a grant issued by an approval shows up as standing exposure on the requester's own screen, with how
 *   long is left rather than an absolute instant to subtract
 * - REVOKING IS IMMEDIATE AND ONE-WAY, and the confirmation says so before the act
 * - the panel is a FINDING: once nothing is held it renders nothing at all, rather than an empty state that
 *   would read as an all-clear
 *
 * SEPARATION OF DUTIES IS WHY THIS TAKES TWO IDENTITIES. The engine refuses an approval by the requester,
 * which is the entire point of the workflow — so the browser's seat asks and a DIFFERENT seat approves. The
 * grant then belongs to the seat the page is signed in as, which is the only way `grants/me/active` has
 * anything to say.
 */
test.describe('my privileged access', () => {
  test('shows what you hold, and security can hand it back early', async ({ page, request }) => {
    const created = await createAccessRequest(request);
    /*
     * THE TARGET, READ BACK. `createAccessRequest` stamps a unique `playwright-<timestamp>` target but
     * returns only the id, and every assertion below has to name THIS grant: a full run shares a database and
     * the seat may legitimately hold others. Reading it costs one call and beats duplicating the fixture.
     */
    const detail = await request.get(`/v1/access-requests/${created}`);
    expect(detail.ok(), await detail.text()).toBe(true);
    const { target } = (await detail.json()) as { target: string };

    /*
     * WHOEVER IS NOT ME. All four seats hold the same wildcard role and only the identity differs, so the
     * approver is chosen by excluding the browser's own email rather than hard-coding a seat — the file's
     * seat assignment is derived from its sorted position and must not be assumed here.
     */
    const me = await request.get('/v1/auth/me');
    expect(me.ok(), await me.text()).toBe(true);
    const { email } = (await me.json()) as { email: string };
    const approverEmail = SEAT_EMAILS.find((seat) => seat !== email);
    expect(approverEmail, `no seat other than ${email} to approve with`).toBeTruthy();

    /*
     * TWO APPROVALS, BY THE SAME OTHER SEAT. `access_request` is a two-step workflow — step 1 needs
     * `access_request.approve` and step 2 `access_request.security_approve` — and only the FINAL step issues
     * the grant. One approval leaves the request `pending`, which is what the controller's own docblock
     * warns about and what this spec learned by asserting on a panel that correctly had nothing to show.
     *
     * The same approver may take both: SoD forbids only requester-equals-approver, and every seat holds the
     * wildcard, so a second identity is enough and a third would be ceremony.
     */
    const approver = await contextAs(approverEmail!);
    for (const step of [1, 2]) {
      const approved = await approver.post(`/v1/access-requests/${created}/approve`, {
        headers: await csrfHeaders(approver),
        data: {},
      });
      expect(approved.status(), `step ${step}: ${await approved.text()}`).toBe(201);
    }

    await gotoInShell(page, '/access');

    /*
     * COUNTED, NOT ASSUMED TO BE ONE. Other specs raise access requests on this seat and a full run shares
     * a database, so the assertion is on the SHAPE of the sentence plus this grant's own unique target —
     * `createAccessRequest` stamps it with a timestamp for exactly that reason.
     */
    await expect(page.getByText(/You hold \d+ active privileged grant/)).toBeVisible({
      timeout: 15_000,
    });
    const row = page.locator('li', { hasText: target });
    await expect(row).toBeVisible();
    // The remaining budget, not the absolute expiry: `createAccessRequest` asks for 8 hours.
    await expect(row).toContainText(/\dh left/);

    // REVOKING NEEDS THE APPROVER'S PERMISSION, which every seat holds. The button names the access it ends,
    // so a screen reader announces which grant is about to go.
    await row.getByRole('button', { name: `Revoke Vpn on ${target}` }).click();
    const confirm = page.getByRole('alertdialog');
    // The API's own precondition, said before the act: a revoked grant is `ACCESS_GRANT_NOT_ACTIVE`, so
    // there is no un-revoke.
    await expect(confirm.getByText(/ends immediately/)).toBeVisible();
    await expect(confirm.getByText(/requesting it again/)).toBeVisible();
    await confirm.getByRole('button', { name: /revoke access/i }).click();

    // GONE. Scoped to THIS grant, because the seat may legitimately hold others from earlier specs in the
    // same run — an assertion that the panel vanished entirely would pass or fail on their presence.
    await expect(page.locator('li', { hasText: target })).toHaveCount(0, { timeout: 15_000 });
  });
});
