/**
 * CSRF token store.
 *
 * The API hands the SPA a session-bound token on every `GET /v1/auth/me` (see
 * `auth-bootstrap.ts`) and requires it in the `X-CSRF-Token` header on every
 * cookie-authenticated state-changing request. The matching secret lives in an httpOnly
 * cookie the browser cannot read, which is what makes the pair a double-submit check.
 *
 * Held in a module variable, not `localStorage`: the token is only useful for the
 * lifetime of the page, and persisting it would outlive the session it is bound to. A
 * refresh re-runs the bootstrap and gets a fresh one.
 */

/** Header name — must match `CSRF_HEADER` in libs/platform/src/http/csrf.ts. */
export const CSRF_HEADER = 'X-CSRF-Token';

/** Methods that never need a token, because they cannot change state. */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token ?? null;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

/**
 * Attach the token to `headers` when `method` needs one.
 *
 * Shared by the generated-client middleware and by every hand-written `fetch` (SSE, AI
 * chat, file downloads, logout), so all of them stay consistent. A call site that forgets
 * the header gets a 403 that reads like a permission bug, which is exactly the kind of
 * mistake worth making unrepeatable.
 */
export function withCsrfHeader(
  method: string,
  headers: Record<string, string> = {},
): Record<string, string> {
  if (SAFE_METHODS.has(method.toUpperCase()) || !csrfToken) return headers;
  return { ...headers, [CSRF_HEADER]: csrfToken };
}
