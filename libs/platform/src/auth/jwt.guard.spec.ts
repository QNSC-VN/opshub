import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt.guard';
import { BFF_SESSION_COOKIE, type BffSessionResolver } from './bff-session-resolver';
import type { JwtPayload } from './jwt.strategy';

/**
 * The BFF session path through the guard.
 *
 * Two authentication modes reaching one principal is the design; the risk is that the
 * newer one skips a check the older one performs. Revocation is the check that matters:
 * a session cookie exempt from the denylist would make logout and offboarding effective
 * for API clients and inert for browsers — the wrong way round, since the browser is
 * where a stolen credential actually gets used.
 */

/**
 * The resolver is a partial double, so the cast lives at the DECLARATION rather than at
 * each call site — the assertions below need the vi.fn surface, the guard needs the
 * interface.
 */
type ResolverDouble = BffSessionResolver & { resolve: ReturnType<typeof vi.fn> };

const principal = {
  sub: 'user-1',
  jti: 'jti-1',
  sessionId: 'sess-1',
  email: 'a@qnsc.vn',
  name: 'A',
  roles: [],
} as unknown as JwtPayload;

function build(
  options: {
    resolver?: ResolverDouble | null;
    tokenDenied?: boolean;
    userRevoked?: boolean;
    cacheThrows?: boolean;
  } = {},
) {
  const store: { userId?: string; userEmail?: string } = {};
  const ctx = { getStore: () => store } as never;

  const authCache = {
    isTokenDenied: vi.fn(() =>
      options.cacheThrows
        ? Promise.reject(new Error('valkey down'))
        : Promise.resolve(options.tokenDenied ?? false),
    ),
    isUserRevoked: vi.fn(() =>
      options.cacheThrows
        ? Promise.reject(new Error('valkey down'))
        : Promise.resolve(options.userRevoked ?? false),
    ),
  } as never;

  const reflector = { getAllAndOverride: () => false } as never;
  const resolver =
    options.resolver === undefined
      ? ({
          enabled: true,
          resolve: vi.fn(() => Promise.resolve(principal)),
        } as unknown as ResolverDouble)
      : options.resolver;

  const guard = new JwtAuthGuard(reflector, authCache, ctx, resolver ?? undefined);
  return { guard, resolver, store, authCache };
}

/** Minimal ExecutionContext carrying just the request the guard reads. */
function execContext(request: Record<string, unknown>) {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

function cookieRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    headers: {},
    cookies: { [BFF_SESSION_COOKIE]: 'sid-1' },
    ip: '203.0.113.7',
    ...overrides,
  };
}

describe('JwtAuthGuard — BFF session path', () => {
  it('authenticates from the session cookie and populates the principal', async () => {
    const { guard, resolver, store } = build();
    const request = cookieRequest();

    await expect(guard.canActivate(execContext(request))).resolves.toBe(true);

    expect(resolver!.resolve).toHaveBeenCalledWith('sid-1', '203.0.113.7');
    expect(request['user']).toBe(principal);
    // bffSid is what lets logout revoke the session the request arrived on.
    expect(request['bffSid']).toBe('sid-1');
    // Without this the request logs and audits with no actor at all.
    expect(store.userId).toBe('user-1');
    expect(store.userEmail).toBe('a@qnsc.vn');
  });

  it('rejects an unresolvable session', async () => {
    const { guard } = build({
      resolver: {
        enabled: true,
        resolve: vi.fn(() => Promise.resolve(null)),
      } as unknown as ResolverDouble,
    });
    await expect(guard.canActivate(execContext(cookieRequest()))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('enforces the token denylist on the cookie path', async () => {
    const { guard } = build({ tokenDenied: true });
    await expect(guard.canActivate(execContext(cookieRequest()))).rejects.toThrow(/revoked/i);
  });

  it('enforces the user-level revocation on the cookie path', async () => {
    const { guard } = build({ userRevoked: true });
    await expect(guard.canActivate(execContext(cookieRequest()))).rejects.toThrow(/revoked/i);
  });

  it('fails open when the denylist cache is unavailable', async () => {
    // Deliberate: a cache outage must not lock out every valid user. Tokens still expire
    // via their own `exp`, so the window is bounded.
    const { guard } = build({ cacheThrows: true });
    await expect(guard.canActivate(execContext(cookieRequest()))).resolves.toBe(true);
  });

  it('prefers a Bearer token over the session cookie', async () => {
    // A caller that attached a token by hand has stated which credential it means.
    const { guard, resolver } = build();
    const request = cookieRequest({ headers: { authorization: 'Bearer abc.def.ghi' } });

    // No passport strategy is wired in this unit context, so the Bearer branch throws —
    // which is itself the proof that the cookie branch was not taken.
    await expect(guard.canActivate(execContext(request))).rejects.toThrow();
    expect(resolver!.resolve).not.toHaveBeenCalled();
  });

  it('skips the cookie path when the resolver is disabled', async () => {
    const { guard, resolver } = build({
      resolver: {
        enabled: false,
        resolve: vi.fn(() => Promise.resolve(principal)),
      } as unknown as ResolverDouble,
    });
    await expect(guard.canActivate(execContext(cookieRequest()))).rejects.toThrow();
    expect(resolver!.resolve).not.toHaveBeenCalled();
  });

  it('skips the cookie path entirely when no resolver is bound', async () => {
    // A product without the BFF: the Bearer flow must be untouched.
    const { guard } = build({ resolver: null });
    await expect(guard.canActivate(execContext(cookieRequest()))).rejects.toThrow();
  });

  it('does not take the cookie path without a session cookie', async () => {
    const { guard, resolver } = build();
    await expect(guard.canActivate(execContext(cookieRequest({ cookies: {} })))).rejects.toThrow();
    expect(resolver!.resolve).not.toHaveBeenCalled();
  });

  it('lets a @Public() route through without resolving anything', async () => {
    const { resolver, authCache } = build();
    const guard = new JwtAuthGuard(
      { getAllAndOverride: () => true } as never,
      authCache,
      { getStore: () => ({}) } as never,
      resolver ?? undefined,
    );
    await expect(guard.canActivate(execContext(cookieRequest()))).resolves.toBe(true);
    expect(resolver!.resolve).not.toHaveBeenCalled();
  });
});
