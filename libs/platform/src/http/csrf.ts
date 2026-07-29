import { BFF_SESSION_COOKIE } from '../auth/bff-session-resolver';

/** Header the SPA echoes the CSRF token in. Must also be in the CORS allow-list. */
export const CSRF_HEADER = 'x-csrf-token';

/**
 * Cookie holding the CSRF *secret* (not the token). `__Host-` pins it to Secure +
 * Path=/ + no Domain, and it is signed, so a subdomain or a non-TLS origin cannot
 * plant one.
 */
export const CSRF_SECRET_COOKIE = '__Host-opshub_csrf';

/** Methods that cannot change state, so cannot be the target of a CSRF attack. */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

/**
 * Routes that must stay reachable without a CSRF token. Each is a deliberate
 * exemption with a reason, not an oversight:
 *
 *  - the BFF login starters run BEFORE any session exists, so there is no token to
 *    issue yet — they are protected instead by the OIDC `state` double-submit;
 *  - `dev-login` is the same, and is hard-blocked whenever NODE_ENV is production;
 *  - `auth/refresh` predates the BFF and authenticates with a rotating refresh
 *    cookie plus its own double-submit token, checked inside the shared AuthService;
 *  - the inbound webhook receiver is called by a service, not a browser: it carries
 *    no cookie and is authenticated by signature.
 */
const EXEMPT_PATHS: readonly string[] = [
  // `/v1/bff/login`, not rally's `/v1/bff/login/start`: opshub has ONE login route,
  // because it authenticates against a single directory. Getting this wrong is not
  // cosmetic — a returning user still holding an expired session cookie would send an
  // ambient credential to a route that cannot issue a CSRF token yet, and be 403'd out
  // of logging in again.
  '/v1/bff/login',
  '/v1/bff/dev-login',
  '/v1/auth/refresh',
  '/v1/webhooks/inbound',
];

/** True when `url`'s path (query stripped) is an exempt route. */
function isExemptPath(url: string): boolean {
  const path = url.split('?')[0];
  return EXEMPT_PATHS.some((exempt) => path === exempt || path.startsWith(`${exempt}/`));
}

/** Whether the Authorization header carries a Bearer token. */
function hasBearerToken(authorization: string | string[] | undefined): boolean {
  const value = Array.isArray(authorization) ? authorization[0] : authorization;
  return typeof value === 'string' && value.trim().toLowerCase().startsWith('bearer ');
}

/**
 * Whether this request must present a valid CSRF token.
 *
 * CSRF is only possible when the browser attaches a credential AMBIENTLY — here, the
 * `__Host-opshub_session` cookie. So the check applies exactly when all of these
 * hold:
 *
 *  1. the method can change state;
 *  2. the request is NOT Bearer-authenticated — a caller that must attach a token by
 *     hand cannot be made to do so by an attacker's page, so demanding a second
 *     token would only break machine clients;
 *  3. a session cookie is actually present — with no ambient credential there is
 *     nothing to forge;
 *  4. the route is not a deliberate exemption.
 *
 * Kept a pure function of the request so the policy lives in ONE place and is
 * unit-testable. Spread across route decorators, an omission is invisible; here, a
 * new controller is covered by default.
 */
export function requiresCsrfProtection(req: {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
}): boolean {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return false;
  if (hasBearerToken(req.headers['authorization'])) return false;
  if (!req.cookies?.[BFF_SESSION_COOKIE]) return false;
  return !isExemptPath(req.url);
}
