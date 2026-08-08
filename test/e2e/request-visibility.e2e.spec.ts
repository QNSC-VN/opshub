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

async function listRequests(
  session: Session,
  query = '',
): Promise<{ id: string; requesterId: string }[]> {
  const res = await app.inject({
    method: 'GET',
    url: `/v1/requests${query}`,
    headers: bearer(session),
  });
  expect(res.statusCode, res.body).toBe(200);
  return (JSON.parse(res.body) as { data: { id: string; requesterId: string }[] }).data;
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
