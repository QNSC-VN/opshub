/**
 * End-to-end proof that approving an access request SUCCEEDS and reports what happened.
 *
 * This exists because the flow was broken and nothing noticed. Approving a request through
 * the engine advances one step of a multi-step workflow, and an intermediate step issues no
 * grant — the request stays `pending` for the next approver. `AccessRequestService.approve`
 * was nevertheless declared `Promise<AccessGrant>` and ended by querying for a grant row
 * that does not exist yet, so it returned `undefined`, the controller read `grant.id`, and
 * the endpoint answered **500 on an approval that had in fact been applied**. A caller saw
 * a server error for a successful action.
 *
 * Why the existing tests missed it, and why this one is shaped the way it is: the unit specs
 * mock the engine, so `engine.approve()` resolving is all they can see, and the reviewer
 * guards (403 on self-approval, 404 on an unknown id) were both correct — the two ENDS of
 * the flow were covered and the middle was not. Only a real request through the real
 * controller, with the real engine deciding there is no grant yet, reaches the defect.
 *
 * TypeScript could not have caught it either: `const [row] = await query` is typed `T`
 * rather than `T | undefined` without `noUncheckedIndexedAccess`.
 *
 * Prereqs: `docker compose -f docker-compose.dev.yml up -d` and `pnpm db:seed`.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE, bearer, createTestApp, login, type Session } from './support/harness';

let app: NestFastifyApplication;
let requester: Session;
let approver: Session;

beforeAll(async () => {
  app = await createTestApp();
  // The requester must NOT be the approver: self-approval is refused by design, and a test
  // that used one identity for both would be asserting the refusal instead of the flow.
  requester = await login(app, FIXTURE.NO_PERMISSIONS);
  approver = await login(app, FIXTURE.ADMIN);
});

afterAll(async () => {
  await app?.close();
});

/** Submit a request as the unprivileged fixture and return its id. */
async function submit(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/access-requests',
    headers: bearer(requester),
    payload: {
      accessType: 'app_admin',
      target: 'jira',
      justification: 'e2e: approval must not 500',
      durationHours: 8,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { id: string }).id;
}

describe('access request approval', () => {
  it('returns the updated request rather than failing when the step issues no grant', async () => {
    const id = await submit();

    const res = await app.inject({
      method: 'POST',
      url: `/v1/access-requests/${id}/approve`,
      headers: bearer(approver),
      payload: { note: 'step approved' },
    });

    // The assertion that would have caught the defect: NOT 500.
    expect(res.statusCode, res.body).toBe(201);

    const body = JSON.parse(res.body) as { id: string; status: string };
    expect(body.id).toBe(id);
    // `status` is the contract now — it is how a caller learns whether anything further is
    // required. An intermediate step leaves it `pending`; a final one resolves it. Both are
    // legitimate, so this asserts the field is a real status rather than pinning one value
    // and breaking the day the workflow gains or loses a step.
    expect(['pending', 'approved']).toContain(body.status);
  });

  it('still refuses self-approval and unknown ids', async () => {
    const id = await submit();

    // The requester approving their own request — separation of duties.
    const own = await app.inject({
      method: 'POST',
      url: `/v1/access-requests/${id}/approve`,
      headers: bearer(requester),
      payload: {},
    });
    expect(own.statusCode).toBe(403);

    // Well-formed but non-existent: 404, not 500.
    const missing = await app.inject({
      method: 'POST',
      url: '/v1/access-requests/019f0000-0000-7000-8000-000000000000/approve',
      headers: bearer(approver),
      payload: {},
    });
    expect(missing.statusCode).toBe(404);
  });

  it('rejects a malformed id with 400 instead of a database error', async () => {
    // Without ParseUUIDPipe the id reached Postgres and came back as
    // `invalid input syntax for type uuid`, surfaced as a 500 — an unhandled server fault
    // any authenticated caller could trigger with a typo.
    const res = await app.inject({
      method: 'GET',
      url: '/v1/access-requests/not-a-uuid',
      headers: bearer(approver),
    });
    expect(res.statusCode).toBe(400);
  });
});
