/**
 * A caller may see requests they are a party to, and no others.
 *
 * WHAT WAS WRONG
 * --------------
 * `RequestEngine.list` and the access-request repository built their WHERE clause from OPTIONAL
 * filters only:
 *
 *     const where = conditions.length ? and(...conditions) : undefined;
 *
 * so an unfiltered call returned EVERY row — every employee's leave, onboarding, catalog and
 * privileged-access request, with justifications and approval chains — to any authenticated
 * caller. `actorId` was used for nothing but the `myQueue` shortcut. `getById`, `listComments`
 * and `addComment` performed no ownership or participant check at all, so `addComment` was a
 * WRITE onto a record the caller could not otherwise read.
 *
 * WHY NOTHING CAUGHT IT
 * ---------------------
 * The unit specs call the engine with filters, and the route ratchet counts decorators — it
 * cannot see authorization that lives (or fails to live) inside a service. Nothing ever issued
 * an unfiltered list as a principal holding no permissions, which is precisely the shape a
 * self-service SPA sends.
 *
 * This spec is named by the `@AuthorizedInService(..., pinnedBy)` declarations on all six
 * routes, and asserts BOTH directions: the employee is narrowed, the permission holder is not.
 *
 * Prereqs: `docker compose -f docker-compose.dev.yml up -d` and `pnpm db:seed`.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE, bearer, createTestApp, login, type Session } from './support/harness';

let app: NestFastifyApplication;
/** `employee` holds NO permission codes — the tier every narrowing rule must constrain. */
let employee: Session;
/** `hr` holds `request.read`, so it is the unconstrained side of every assertion. */
let hr: Session;
/** A request owned by the employee, so there is something they legitimately may see. */
let ownRequestId: string;
/** A request owned by HR — the thing the employee must NOT be able to reach. */
let foreignRequestId: string;

interface RequestRow {
  id: string;
  requesterId: string;
  /** Resolved server-side. Null when the requester's employee row is gone. */
  requesterName: string | null;
}

async function listRequests(session: Session, query = ''): Promise<RequestRow[]> {
  const res = await app.inject({
    method: 'GET',
    url: `/v1/requests${query}`,
    headers: bearer(session),
  });
  expect(res.statusCode, res.body).toBe(200);
  return (JSON.parse(res.body) as { data: RequestRow[] }).data;
}

beforeAll(async () => {
  app = await createTestApp();
  employee = await login(app, FIXTURE.NO_PERMISSIONS);
  hr = await login(app, FIXTURE.HR);

  // File a leave request as the employee: it enters the generic engine, so it is a request
  // they ARE a party to, alongside whatever the seed created for everyone else.
  const res = await app.inject({
    method: 'POST',
    url: '/v1/workforce/leave',
    headers: bearer(employee),
    payload: {
      leaveType: 'annual',
      startDate: '2027-03-01',
      endDate: '2027-03-02',
      reason: 'request visibility fixture',
    },
  });
  expect(res.statusCode, res.body).toBe(201);

  const own = await listRequests(employee);
  expect(own.length, 'the employee should see the request they just filed').toBeGreaterThan(0);
  ownRequestId = own[0].id;

  // A request the employee is NOT a party to. Created rather than looked up: the seed produces
  // none, so the first version of this spec found nothing foreign to test against and its three
  // refusal cases failed on the fixture instead of on the rule.
  const hrRes = await app.inject({
    method: 'POST',
    url: '/v1/workforce/leave',
    headers: bearer(hr),
    payload: {
      leaveType: 'annual',
      startDate: '2027-04-01',
      endDate: '2027-04-02',
      reason: 'foreign request fixture',
    },
  });
  expect(hrRes.statusCode, hrRes.body).toBe(201);

  const hrRows = await listRequests(hr);
  const foreign = hrRows.find((r) => r.requesterId === FIXTURE.HR.id);
  expect(foreign, 'HR should see the request HR just filed').toBeDefined();
  foreignRequestId = foreign!.id;

  // And an ACCESS request owned by HR. Needed for the same reason: with none in the database,
  // "the employee sees no foreign access requests" is true whether or not the narrowing works —
  // proven by mutation testing, where removing the narrowing left that assertion passing.
  const grantRes = await app.inject({
    method: 'POST',
    url: '/v1/access-requests',
    headers: bearer(hr),
    payload: {
      accessType: 'pim_role',
      target: 'visibility-fixture',
      justification: 'foreign access-request fixture',
      durationHours: 4,
    },
  });
  expect(grantRes.statusCode, grantRes.body).toBe(201);
});

afterAll(async () => {
  await app?.close();
});

describe('request visibility', () => {
  it('narrows an unfiltered list to the caller', async () => {
    const rows = await listRequests(employee);

    const foreign = rows.filter((r) => r.requesterId !== FIXTURE.NO_PERMISSIONS.id);
    expect(
      foreign,
      'An unfiltered GET /requests returned requests belonging to other people. This is the ' +
        'leak: WHERE was built from optional filters, so no filters meant no WHERE.',
    ).toEqual([]);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('names the requester, so an approval queue can be decided from', async () => {
    /*
     * WHAT THE INBOX SHOWED BEFORE: the request type and `id.slice(0, 8)`. No requester — so the screen
     * whose buttons are Approve and Reject did not say who was asking. The id made it worse rather than
     * better: these are uuid v7, TIME-PREFIXED, so requests filed in the same window share their leading
     * characters and several rows rendered the same eight.
     *
     * Asserted against the API rather than only in the browser, because it is the API that has to supply
     * it: the SPA cannot resolve fifty uuids without fifty requests.
     */
    const rows = await listRequests(employee);
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(
        row.requesterName,
        `request ${row.id} came back with no requester name, so the inbox row is undecidable`,
      ).toBeTruthy();
    }
  });

  it('still names the requester after they are offboarded', async () => {
    /*
     * I WROTE THIS TEST BACKWARDS FIRST, and the failure was the useful part: I asserted the name comes
     * back null once the requester leaves. It does not, because offboarding sets `status` and does not
     * delete the row — there is no DELETE route for an employee at all, only `/avatar`.
     *
     * Which makes the real property the opposite one, and a better one: a leaver's request still says who
     * filed it. An offboarded employee's access request is exactly what an access review comes back to,
     * and a queue that forgot the name would be answering "somebody asked for this" — the same
     * uninterpretable row the uuid gave, arriving by a different route.
     *
     * The resolution stays a LEFT lookup and `requesterName` stays nullable anyway: it costs nothing, and
     * an inner join would make the REQUEST disappear with the employee rather than just the name.
     */
    const admin = await login(app, FIXTURE.ADMIN);
    const email = `inbox.leaver.${Date.now().toString(36)}@opshub.local`;

    const created = await app.inject({
      method: 'POST',
      url: '/v1/employees',
      headers: bearer(admin),
      payload: { email, displayName: 'Departing Requester', roles: ['employee'] },
    });
    expect(created.statusCode, created.body).toBe(201);
    const body = JSON.parse(created.body) as { data?: { id: string }; id?: string };
    const leaverId = body.data?.id ?? body.id!;

    const leaver = await login(app, { email });
    const filed = await app.inject({
      method: 'POST',
      url: '/v1/workforce/leave',
      headers: bearer(leaver),
      payload: {
        // A Monday and a Tuesday: a weekend window is refused with LEAVE_NO_WORKING_DAYS, which is
        // what the first version of this test picked.
        leaveType: 'annual',
        startDate: '2027-05-03',
        endDate: '2027-05-04',
        reason: 'filed by somebody about to leave',
      },
    });
    expect(filed.statusCode, filed.body).toBe(201);

    const offboarded = await app.inject({
      method: 'PATCH',
      url: `/v1/employees/${leaverId}/status`,
      headers: bearer(admin),
      payload: { status: 'offboarded' },
    });
    expect(offboarded.statusCode, offboarded.body).toBe(200);

    const rows = await listRequests(hr, `?requesterId=${leaverId}`);
    expect(rows.length, 'the request vanished along with its requester').toBeGreaterThan(0);
    expect(
      rows[0].requesterName,
      'an offboarded requester lost their name, so an access review reads "somebody asked for this"',
    ).toBe('Departing Requester');
  });

  it('does not let a requesterId filter widen the narrowing', async () => {
    // The narrowing predicate is ANDed with the caller's filters rather than overwriting them,
    // so asking for someone else's requests cannot reach them.
    const rows = await listRequests(employee, `?requesterId=${FIXTURE.HR.id}`);

    expect(
      rows,
      'Filtering by another user id escaped the narrowing — the predicate is being replaced ' +
        'rather than ANDed.',
    ).toEqual([]);
  });

  it("lets a holder of request.read see other people's requests", async () => {
    const rows = await listRequests(hr);

    // The other half of the rule: narrowing must not apply to the staff tiers, or the approval
    // queues stop working. Asserted by finding the employee's request from HR's session.
    expect(
      rows.some((r) => r.requesterId === FIXTURE.NO_PERMISSIONS.id),
      'HR holds request.read but cannot see an employee request — the narrowing is applying ' +
        'to a permission holder.',
    ).toBe(true);
  });

  it('refuses a by-id read of a request the caller is not party to', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/requests/${foreignRequestId}`,
      headers: bearer(employee),
    });

    expect(res.statusCode, res.body).toBe(403);
  });

  it("allows a by-id read of the caller's own request", async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/requests/${ownRequestId}`,
      headers: bearer(employee),
    });

    expect(res.statusCode, res.body).toBe(200);
  });

  it('refuses reading comments on a request the caller is not party to', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/requests/${foreignRequestId}/comments`,
      headers: bearer(employee),
    });

    expect(res.statusCode, res.body).toBe(403);
  });

  it('refuses COMMENTING on a request the caller is not party to', async () => {
    // The write case, and the worst of the six: posting onto a record you cannot read.
    const res = await app.inject({
      method: 'POST',
      url: `/v1/requests/${foreignRequestId}/comments`,
      headers: bearer(employee),
      payload: { body: 'should not be accepted' },
    });

    expect(res.statusCode, res.body).toBe(403);
  });

  it('lets the caller comment on their own request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/requests/${ownRequestId}/comments`,
      headers: bearer(employee),
      payload: { body: 'my own request' },
    });

    expect(res.statusCode, res.body).toBe(201);
  });

  it('narrows the access-request list to the caller', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/access-requests',
      headers: bearer(employee),
    });
    expect(res.statusCode, res.body).toBe(200);

    const rows = (JSON.parse(res.body) as { data: { requesterId: string }[] }).data;
    expect(
      rows.filter((r) => r.requesterId !== FIXTURE.NO_PERMISSIONS.id),
      'the access-request list leaked other requesters',
    ).toEqual([]);

    // HR's own list must contain the request HR filed, or the assertion above proves nothing:
    // an empty table satisfies "no foreign rows" with the narrowing removed.
    const hrRes = await app.inject({
      method: 'GET',
      url: '/v1/access-requests',
      headers: bearer(hr),
    });
    expect(hrRes.statusCode, hrRes.body).toBe(200);
    const hrOwned = (JSON.parse(hrRes.body) as { data: { requesterId: string }[] }).data;
    expect(
      hrOwned.some((r) => r.requesterId === FIXTURE.HR.id),
      'fixture is not exercising the narrowing — no foreign access request exists to hide',
    ).toBe(true);
  });
});
