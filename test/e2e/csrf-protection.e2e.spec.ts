/**
 * End-to-end proof that CSRF protection is actually ENFORCED.
 *
 * `libs/platform/src/http/csrf.spec.ts` already tests `requiresCsrfProtection` as a pure
 * function, and thoroughly. What it cannot test is whether anything CALLS it: the policy is
 * attached by a single `onRequest` hook in `bootstrapApp`, and registering
 * `@fastify/csrf-protection` only decorates `reply.generateCsrf()` and `app.csrfProtection`
 * — it enforces NOTHING until that hook attaches it. rally shipped exactly that defect: the
 * plugin registered, the hook never wired, no token ever issued, and the only thing actually
 * stopping a cross-site request was `SameSite=Strict` on the session cookie. A single
 * control a future cookie tweak could silently remove, with no test failing.
 *
 * So these specs assert the wiring, not the policy: that a token is issued, that omitting it
 * fails, that presenting it succeeds, that it is bound to the session that requested it, and
 * that the deliberate exemptions still work. They go through `createTestApp()`, which calls
 * the same `bootstrapApp` as production — a spec that assembled its own Nest app would prove
 * nothing here, because the hook it is testing lives in the part it skipped.
 *
 * opshub differs from rally in where the token comes from: there is no `/v1/bff/me`. The
 * token is minted by `GET /v1/auth/me`, and only for a request that arrived on the session
 * COOKIE (`request.bffSid`) — a Bearer caller cannot be a CSRF victim, so it gets none.
 *
 * Prereqs: `docker compose -f docker-compose.dev.yml up -d` and `pnpm db:seed`.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BFF_SESSION_COOKIE, CSRF_SECRET_COOKIE } from '@platform';
import { FIXTURE, bearer, createTestApp, login } from './support/harness';

interface CookieSession {
  /** Cookie header carrying both the session id and the CSRF secret. */
  cookie: string;
  csrfToken: string;
}

let app: NestFastifyApplication;

/** Pull one cookie's value out of a `set-cookie` header list. */
function readCookie(setCookie: string | string[] | undefined, name: string): string | undefined {
  const all = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const raw of all) {
    const [pair] = raw.split(';');
    const [key, ...rest] = pair.split('=');
    if (key.trim() === name) return rest.join('=');
  }
  return undefined;
}

/**
 * Run the exact sequence the SPA runs on start: establish a server-side session over the
 * BFF, then call `/v1/auth/me` to receive the CSRF token and the signed secret cookie it
 * plants.
 *
 * Deliberately NOT `harness.login()`, which uses the Bearer-issuing `/v1/auth/dev-login`.
 * CSRF only exists for ambient credentials, so a Bearer session cannot exercise it — this
 * needs the cookie path.
 */
async function signIn(): Promise<CookieSession> {
  const login = await app.inject({
    method: 'POST',
    url: '/v1/bff/dev-login',
    payload: { email: FIXTURE.NO_PERMISSIONS.email },
  });
  expect(login.statusCode, login.body).toBe(204);

  const sid = readCookie(login.headers['set-cookie'], BFF_SESSION_COOKIE);
  expect(sid, 'BFF dev-login set no session cookie').toBeDefined();

  const me = await app.inject({
    method: 'GET',
    url: '/v1/auth/me',
    headers: { cookie: `${BFF_SESSION_COOKIE}=${sid}` },
  });
  expect(me.statusCode, me.body).toBe(200);

  const csrfSecret = readCookie(me.headers['set-cookie'], CSRF_SECRET_COOKIE);
  expect(csrfSecret, '/v1/auth/me planted no CSRF secret cookie').toBeDefined();

  const { csrfToken } = me.json<{ csrfToken?: string }>();
  expect(csrfToken, '/v1/auth/me returned no csrfToken').toBeTruthy();

  return {
    cookie: `${BFF_SESSION_COOKIE}=${sid}; ${CSRF_SECRET_COOKIE}=${csrfSecret}`,
    csrfToken: csrfToken!,
  };
}

beforeAll(async () => {
  app = await createTestApp();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('CSRF protection is enforced', () => {
  it('issues a session-bound token and the signed secret cookie from /v1/auth/me', async () => {
    const session = await signIn();
    expect(session.csrfToken).toMatch(/./);
  });

  // The assertion that would have caught rally's defect: without the hook this is a 204.
  it('rejects a cookie-authenticated POST with no CSRF token', async () => {
    const session = await signIn();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/bff/logout',
      headers: { cookie: session.cookie },
    });
    expect(res.statusCode).toBe(403);
  });

  // The other direction — otherwise the 403 above is also satisfied by a route that is
  // simply broken, or by a CSRF gate that rejects everything.
  it('accepts the same POST when the token is presented', async () => {
    const session = await signIn();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/bff/logout',
      headers: { cookie: session.cookie, 'x-csrf-token': session.csrfToken },
    });
    expect(res.statusCode, res.body).toBe(204);
  });

  it("rejects another session's token", async () => {
    // The replay shape an attacker actually has: a token lifted from a different session,
    // presented against this one.
    //
    // On what stops it, having tried to prove it: NOT this test alone. Each session gets its
    // own secret cookie, so the pair mismatches on the secret before `userInfo` is even
    // consulted. And the `userInfo` binding turns out to be impossible to weaken in
    // isolation — `/v1/auth/me` passes the sid to `generateCsrf` while the plugin verifies
    // with `getUserInfo`, so the two sides must agree, and every mutation of either (drop
    // `userInfo: true`, return a constant, blank both) breaks logout for EVERY user instead
    // of allowing a replay. `accepts the same POST when the token is presented` is what
    // catches all of those, every time.
    //
    // So this asserts the outcome and the secret binding; the session binding has no
    // independent failure mode to test. An earlier version of this file built a 30-line
    // same-secret-different-session construction to isolate it and could not be shown to
    // catch anything the simple version misses.
    const victim = await signIn();
    const attacker = await signIn();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/bff/logout',
      headers: { cookie: victim.cookie, 'x-csrf-token': attacker.csrfToken },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a garbage token', async () => {
    const session = await signIn();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/bff/logout',
      headers: { cookie: session.cookie, 'x-csrf-token': 'not-a-real-token' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a token presented WITHOUT the secret cookie', async () => {
    // Double-submit needs both halves. A token alone — the half an attacker's page could
    // plausibly obtain — must not authorize anything.
    const session = await signIn();
    const sessionOnly = session.cookie.split(';')[0];
    const res = await app.inject({
      method: 'POST',
      url: '/v1/bff/logout',
      headers: { cookie: sessionOnly, 'x-csrf-token': session.csrfToken },
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not accept the token from the request body', async () => {
    // A token an attacker can plant in a form post must not authorize anything.
    //
    // TWO independent controls produce this, which is why neither shows up as a single
    // mutation: the header-only `getToken` never looks at the body, AND the gate is an
    // `onRequest` hook, which runs before body parsing so `req.body` is undefined anyway.
    // Verified — removing the custom `getToken` does not change the result, and neither
    // does moving the hook to `preHandler`. Both have to go for this to regress.
    //
    // Worth keeping regardless: it pins the OUTCOME, which is the thing that must hold no
    // matter which of the two someone decides to simplify away.
    const session = await signIn();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/bff/logout',
      headers: { cookie: session.cookie },
      payload: { _csrf: session.csrfToken },
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not require a token on a safe method', async () => {
    const session = await signIn();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { cookie: session.cookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it('exempts the BFF login starter, which runs before any session exists', async () => {
    // A 403 here would make logging in impossible for a returning user still holding an
    // expired session cookie — they would send an ambient credential to the one route that
    // cannot issue a token yet. This is why the exemption is `/v1/bff/login` and not
    // rally's `/v1/bff/login/start`.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/bff/dev-login',
      payload: { email: FIXTURE.NO_PERMISSIONS.email },
    });
    expect(res.statusCode).not.toBe(403);
  });

  it('leaves Bearer-authenticated requests untouched by the CSRF gate', async () => {
    // No ambient credential means no CSRF exposure, so a machine client must not be forced
    // to fetch a browser token. A bogus Bearer therefore fails AUTH (401), not CSRF.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/bff/logout',
      headers: { authorization: 'Bearer not.a.real.token' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.body.toLowerCase()).not.toContain('csrf');
  });

  it('does not gate a request that carries no ambient credential at all', async () => {
    // With no session cookie there is nothing to forge, so the CSRF gate must not fire —
    // otherwise every unauthenticated POST would 403 instead of 401, and the API would
    // report "forbidden" to callers who simply had not logged in.
    const res = await app.inject({ method: 'POST', url: '/v1/bff/logout' });
    expect(res.statusCode).toBe(401);
  });

  it('mints no CSRF token for a Bearer-authenticated /v1/auth/me', async () => {
    // Minting one would plant a CSRF secret cookie on API clients that will never send it
    // back, and imply a protection the Bearer path does not use.
    //
    // Goes through the harness `login()` rather than injecting /v1/auth/dev-login directly:
    // that route is rate-limited to 5 per 15 minutes per IP, and this file already spends
    // most of the budget on its BFF logins, so a direct call here gets a 429 that reads as
    // an unrelated failure. `login()` clears the bucket first.
    const session = await login(app, FIXTURE.NO_PERMISSIONS);

    const me = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(session),
    });
    expect(me.statusCode, me.body).toBe(200);
    expect(me.json<{ csrfToken?: string }>().csrfToken).toBeUndefined();
  });
});
