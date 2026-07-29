/**
 * The opaque BFF session-id cookie name is owned by the platform auth layer, because the
 * shared `JwtAuthGuard` READS it while this module ISSUES it. Re-exported here so BFF
 * code has a single import site for all its cookie names.
 */
export { BFF_SESSION_COOKIE } from '@platform';

/**
 * Short-lived OIDC `state` cookie, browser-bound for the login round-trip.
 *
 * `SameSite=Lax`, not Strict: it has to survive the top-level redirect back from Entra,
 * and a Strict cookie is not sent on a cross-site navigation — the callback would then
 * see no cookie state and reject every login. `__Host-` still keeps it Secure and
 * origin-locked.
 */
export const BFF_STATE_COOKIE = '__Host-bff_state';

/** Lifetime of the state cookie — matches the package's auth-request TTL (10 minutes). */
export const BFF_STATE_COOKIE_MAX_AGE_SECONDS = 10 * 60;
