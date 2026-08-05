import { withCsrfHeader } from './csrf';

/**
 * `fetch` for the handful of calls that cannot go through the generated client — SSE
 * streams, the AI chat stream, and a few endpoints that predate the OpenAPI client.
 *
 * It exists so those call sites cannot get the credential wrong. Two things must be true
 * of every cookie-authenticated request, and both are easy to forget in a hand-written
 * fetch:
 *
 *   - `credentials: 'include'`, or the browser omits the session cookie and the request
 *     401s — which reads like an expired login rather than a missing option;
 *   - `X-CSRF-Token` on anything state-changing, or the server's CSRF hook answers 403 —
 *     which reads like a permission bug.
 *
 * Both diagnoses cost more to reach than they should, so neither is left to the caller.
 * The generated client applies the same two rules in its middleware; this is the same
 * policy for the escape hatch.
 *
 * `Content-Type: application/json` is added only when there is a body, so a GET or an SSE
 * subscription is not given a header describing a payload it does not have.
 */
export function sessionFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = init.method ?? 'GET';
  const supplied = (init.headers ?? {}) as Record<string, string>;
  const base: Record<string, string> =
    init.body != null ? { 'Content-Type': 'application/json' } : {};

  return fetch(url, {
    ...init,
    credentials: 'include',
    headers: withCsrfHeader(method, { ...base, ...supplied }),
  });
}
