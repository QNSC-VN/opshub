import { describe, expect, it } from 'vitest';
import { CSRF_HEADER, requiresCsrfProtection } from './csrf';
import { BFF_SESSION_COOKIE } from '../auth/bff-session-resolver';

/**
 * The CSRF policy, which is enforced by ONE `onRequest` hook rather than per route. That
 * makes this function the whole rule: if it returns false for a request that should be
 * checked, the route is silently unprotected, and nothing else in the system will say so.
 */

function req(overrides: Partial<Parameters<typeof requiresCsrfProtection>[0]> = {}) {
  return {
    method: 'POST',
    url: '/v1/assets',
    headers: {},
    cookies: { [BFF_SESSION_COOKIE]: 'sid-1' },
    ...overrides,
  };
}

describe('requiresCsrfProtection', () => {
  it('protects a cookie-authenticated write', () => {
    expect(requiresCsrfProtection(req())).toBe(true);
  });

  it.each(['GET', 'HEAD', 'OPTIONS', 'TRACE'])('skips %s — it cannot change state', (method) => {
    expect(requiresCsrfProtection(req({ method }))).toBe(false);
  });

  it('is case-insensitive about the method', () => {
    // Fastify normalises, but the policy must not depend on that.
    expect(requiresCsrfProtection(req({ method: 'get' }))).toBe(false);
    expect(requiresCsrfProtection(req({ method: 'post' }))).toBe(true);
  });

  it.each(['PUT', 'PATCH', 'DELETE'])('protects %s too, not just POST', (method) => {
    expect(requiresCsrfProtection(req({ method }))).toBe(true);
  });

  // A caller that must attach a credential by hand cannot be made to do so by an
  // attacker's page, so demanding a second token would only break machine clients.
  it('skips a Bearer-authenticated write', () => {
    expect(requiresCsrfProtection(req({ headers: { authorization: 'Bearer abc.def.ghi' } }))).toBe(
      false,
    );
  });

  it('recognises a lowercase bearer scheme', () => {
    expect(requiresCsrfProtection(req({ headers: { authorization: 'bearer abc' } }))).toBe(false);
  });

  it('does NOT treat a non-Bearer Authorization header as an exemption', () => {
    // Basic auth is still an ambient-ish credential a browser can be made to send, and
    // more importantly it is not the machine-client path this exemption exists for.
    expect(requiresCsrfProtection(req({ headers: { authorization: 'Basic dXNlcjpwdw==' } }))).toBe(
      true,
    );
  });

  // With no ambient credential there is nothing to forge.
  it('skips a write with no session cookie', () => {
    expect(requiresCsrfProtection(req({ cookies: {} }))).toBe(false);
  });

  it('skips a write when cookies are absent entirely', () => {
    expect(requiresCsrfProtection(req({ cookies: undefined }))).toBe(false);
  });

  it('ignores unrelated cookies', () => {
    expect(requiresCsrfProtection(req({ cookies: { theme: 'dark' } }))).toBe(false);
  });

  describe('exempt routes', () => {
    it.each([
      // Runs BEFORE any session exists, so there is no token to issue yet; protected
      // instead by the OIDC `state` double-submit.
      '/v1/bff/login',
      // Same, and hard-blocked whenever NODE_ENV is production.
      '/v1/bff/dev-login',
      // Predates the BFF and carries its own session-bound double-submit token, checked
      // inside the shared AuthService.
      '/v1/auth/refresh',
      // Called by a service, not a browser: no cookie, authenticated by signature.
      '/v1/webhooks/inbound',
    ])('exempts %s', (url) => {
      expect(requiresCsrfProtection(req({ url }))).toBe(false);
    });

    it('exempts a sub-path of an exempt route', () => {
      expect(requiresCsrfProtection(req({ url: '/v1/webhooks/inbound/github' }))).toBe(false);
    });

    it('ignores the query string when matching', () => {
      expect(requiresCsrfProtection(req({ url: '/v1/bff/login?returnTo=%2Fassets' }))).toBe(false);
    });

    // The exemptions are anchored, not substring matches — otherwise a route could be
    // exempted by accident just by being named similarly.
    it('does not exempt a route that merely starts with the same characters', () => {
      expect(requiresCsrfProtection(req({ url: '/v1/auth/refresh-all' }))).toBe(true);
    });

    it('does not exempt a route that only CONTAINS an exempt path', () => {
      expect(requiresCsrfProtection(req({ url: '/v1/admin/v1/bff/login' }))).toBe(true);
    });

    it('protects the routes next to an exempt one', () => {
      expect(requiresCsrfProtection(req({ url: '/v1/auth/logout' }))).toBe(true);
      expect(requiresCsrfProtection(req({ url: '/v1/bff/logout' }))).toBe(true);
    });
  });

  it('names the header the SPA must echo', () => {
    // Pinned because the value appears in three places that must agree: this policy, the
    // plugin's getToken in the API bootstrap, and the CORS allow-list.
    expect(CSRF_HEADER).toBe('x-csrf-token');
  });
});
