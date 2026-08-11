/**
 * The message the API actually sent — not a guess about what went wrong.
 *
 * WHY THIS EXISTS. Every screen used to invent its own sentence for a failed mutation: "Failed to
 * activate. The employee may already have an active contract." was shown for a 412 whose real message
 * was "has no signature date. Supply `signedAt`". The invented sentence named the one cause it was not,
 * so the user had no route to fixing it — and it cost real debugging time to find that out, because the
 * screen was confidently wrong rather than silent.
 *
 * The API already writes these messages for people: `PreconditionFailedException` carries a code and a
 * sentence naming the record and the rule. Passing it through is both less code and better UX than
 * paraphrasing it, and it cannot drift when the rule changes.
 *
 * `fallback` is still required, for the cases where there is no envelope to read: a network failure, a
 * 502 from the proxy, a 500 whose body is deliberately opaque. It should say what FAILED ("Failed to
 * activate the contract."), not why — guessing why is the thing this replaces.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const message = (error as { error?: { message?: unknown } } | null | undefined)?.error?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

/**
 * The same, for a raw `Response` from `sessionFetch`.
 *
 * A few call sites predate the generated client and still fetch by hand; they threw on `!res.ok`
 * without reading the body, so the reason the API gave was parsed by nobody. This keeps them on one
 * convention with the typed client rather than growing a second one.
 */
export async function responseErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return apiErrorMessage(body, fallback);
}
