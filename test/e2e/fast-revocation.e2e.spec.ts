/**
 * Offboarding stops an ALREADY-ISSUED credential, on both authentication paths.
 *
 * WHAT WAS UNCOVERED. `EmployeeService.updateStatus` calls `authCache.revokeUser(id, 24h)` on
 * offboarding, and `JwtAuthGuard.enforceDenylist` checks `isUserRevoked(sub)` — the mechanism the guard
 * documents as fast revocation, "blocks them within milliseconds". No test exercised it.
 *
 * The two neighbouring suites both look like they do and do not:
 *
 *   - `offboarding-revocation.e2e.spec.ts` proves the removals are AUDITED — status, roles, grants,
 *     hardware, sessions — and that the role claims end up empty. It never presents a credential
 *     afterwards.
 *   - `authz-revocation.e2e.spec.ts` proves a REVOKED PERMISSION takes effect on the same token, and
 *     says so explicitly in a comment: "403, not 401: the token is still perfectly valid and
 *     authentication never became the problem". It is about a different mechanism and deliberately not
 *     about this one.
 *
 * So the gap was exact: an offboarded employee's live token being refused was the one thing nobody
 * asked for. Without it, a refactor that dropped `revokeUser` from the offboarding hook, or
 * `enforceDenylist` from either path, would extend a leaver's access from milliseconds to the full
 * access-token lifetime with every test still green.
 *
 * BOTH PATHS, because they are separate code and the guard's own docblock names the asymmetry: "a
 * session cookie that skipped revocation would make logout and offboarding effective for API clients
 * and inert for browsers, which is the direction that matters." The SPA holds no tokens at all — it is
 * cookie-only — so the cookie case is the one that describes real users.
 *
 * THROWAWAY EMPLOYEES, NEVER FIXTURES. Offboarding a fixture revokes its sessions for every spec that
 * runs afterwards, which is the cross-spec pollution that made `performance.e2e.spec.ts` fail on a
 * database other suites had already touched.
 *
 * Prereqs: `docker compose -f docker-compose.dev.yml up -d`, `pnpm db:migrate`, `pnpm db:seed`.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE, bearer, createTestApp, login, unwrap, type Session } from './support/harness';

let app: NestFastifyApplication;
let admin: Session;

const RUN = Date.now().toString(36).toUpperCase().slice(-6);
let seq = 0;

interface EmployeeRow {
  id: string;
  email: string;
}

/** A fresh employee nobody else's spec depends on. */
async function throwaway(): Promise<EmployeeRow> {
  const email = `revoke.${RUN}.${++seq}@opshub.local`;
  const res = await app.inject({
    method: 'POST',
    url: '/v1/employees',
    headers: bearer(admin),
    payload: { email, displayName: `Revocation probe ${seq}`, roles: ['employee'] },
  });
  expect(res.statusCode, res.body).toBe(201);
  return unwrap<EmployeeRow>(JSON.parse(res.body));
}

async function offboard(id: string): Promise<void> {
  const res = await app.inject({
    method: 'PATCH',
    url: `/v1/employees/${id}/status`,
    headers: bearer(admin),
    payload: { status: 'offboarded' },
  });
  expect(res.statusCode, res.body).toBe(200);
}

/** `GET /auth/me` with a bearer token — the API-client path. */
async function meWithToken(accessToken: string): Promise<number> {
  const res = await app.inject({
    method: 'GET',
    url: '/v1/auth/me',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return res.statusCode;
}

/** `GET /auth/me` with a session cookie — the SPA's only path. */
async function meWithCookie(cookieHeader: string): Promise<number> {
  const res = await app.inject({
    method: 'GET',
    url: '/v1/auth/me',
    headers: { cookie: cookieHeader },
  });
  return res.statusCode;
}

/** Sign in through the BFF, which issues the `__Host-opshub_session` cookie the SPA uses. */
async function bffLogin(email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/bff/dev-login',
    payload: { email },
  });
  // 204, not 200: the BFF login's whole answer is the `Set-Cookie` header, so there is no body.
  expect(res.statusCode, res.body).toBe(204);
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  expect(cookies.length, 'the BFF login set no cookie, so this proves nothing').toBeGreaterThan(0);
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

beforeAll(async () => {
  app = await createTestApp();
  admin = await login(app, FIXTURE.ADMIN);
});

afterAll(async () => {
  await app?.close();
});

describe('fast revocation on offboarding', () => {
  it('refuses a bearer token issued before the offboarding', async () => {
    const employee = await throwaway();
    const session = await login(app, employee);

    /*
     * ASSERTED BEFORE AS WELL AS AFTER. Without the "before", a token that never worked — a typo in the
     * fixture, a login that quietly failed — would produce the same 401 and read as revocation working.
     */
    expect(await meWithToken(session.accessToken), 'the token did not work even before').toBe(200);

    await offboard(employee.id);

    // The SAME token. Not a fresh login, which would be refused for a different reason entirely.
    expect(
      await meWithToken(session.accessToken),
      'an offboarded employee kept using a token issued before, so revocation waits for expiry',
    ).toBe(401);
  });

  it('refuses a session cookie issued before the offboarding', async () => {
    /*
     * THE DIRECTION THAT MATTERS, per the guard's own docblock. The SPA authenticates only by cookie, so
     * if `enforceDenylist` were ever dropped from the BFF path, offboarding would remain effective for
     * API clients — and every bearer-based test would still pass — while every browser session survived.
     */
    const employee = await throwaway();
    const cookie = await bffLogin(employee.email);

    expect(await meWithCookie(cookie), 'the cookie did not work even before').toBe(200);

    await offboard(employee.id);

    expect(
      await meWithCookie(cookie),
      'an offboarded employee kept a live browser session, so offboarding is inert for the SPA',
    ).toBe(401);
  });

  it('leaves everybody else signed in', async () => {
    /*
     * The blast radius. `revokeUser` is keyed on one subject, and a denylist that matched too broadly
     * would sign the whole company out on any offboarding — a failure the two tests above cannot see,
     * because they only ever ask about the person who was offboarded.
     */
    const [leaver, colleague] = [await throwaway(), await throwaway()];
    const colleagueSession = await login(app, colleague);
    expect(await meWithToken(colleagueSession.accessToken)).toBe(200);

    await offboard(leaver.id);

    expect(
      await meWithToken(colleagueSession.accessToken),
      'offboarding one employee revoked another',
    ).toBe(200);
  });

  it('lets a reactivated employee back in', async () => {
    /*
     * `updateStatus` calls `unrevokeUser` when the status returns to `active`, which is the only thing
     * that clears a 24-hour denylist entry. Without it an offboarding reversed by mistake would lock the
     * person out for a day with nothing in the product explaining why — and a NEW login would not help,
     * because the denylist is keyed on the subject rather than on the token.
     */
    const employee = await throwaway();
    await offboard(employee.id);

    const reinstate = await app.inject({
      method: 'PATCH',
      url: `/v1/employees/${employee.id}/status`,
      headers: bearer(admin),
      payload: { status: 'active' },
    });
    expect(reinstate.statusCode, reinstate.body).toBe(200);

    // A fresh login, because the point is that a reinstated employee can work again — not that an old
    // token comes back to life, which it must not.
    const session = await login(app, employee);
    expect(
      await meWithToken(session.accessToken),
      'a reinstated employee is still denylisted, so they cannot sign back in',
    ).toBe(200);
  });
});
