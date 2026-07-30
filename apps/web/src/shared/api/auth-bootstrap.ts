/**
 * Auth bootstrap — runs once on app start, and again on every page refresh.
 *
 * Restores the session from the same-origin `__Host-opshub_session` cookie by calling the
 * cookie-authenticated `GET /v1/auth/me`. There are no in-browser tokens: the shared
 * guard resolves the session server-side and refreshes the underlying access token
 * itself. Must be awaited before the router guard reads `isAuthenticated()`.
 */
import { ENV } from '@/shared/config/env';
import { setCsrfToken } from './csrf';
import { useAuthStore, type SessionUser } from './auth-store';

let _bootstrapPromise: Promise<void> | null = null;

/** Idempotent: React StrictMode's double-invoke shares one in-flight promise. */
export function bootstrapAuth(): Promise<void> {
  if (_bootstrapPromise) return _bootstrapPromise;
  _bootstrapPromise = _run();
  return _bootstrapPromise;
}

/** Call after logout so the next navigation bootstraps again. */
export function resetBootstrap(): void {
  _bootstrapPromise = null;
}

async function _run(): Promise<void> {
  const { clear, setReady, setUser } = useAuthStore.getState();
  try {
    // `credentials: 'include'` is what sends the session cookie. Same-origin in every
    // environment — locally via the Vite proxy, deployed via the Cloudflare Pages
    // Function — so this is not a cross-site request and needs no CORS.
    const res = await fetch(`${ENV.API_BASE_URL}/v1/auth/me`, {
      credentials: 'include',
      referrerPolicy: 'no-referrer',
      headers: { accept: 'application/json' },
    });

    if (!res.ok) {
      // 401 is the ordinary "not signed in yet" answer, not an error worth surfacing.
      clear();
      return;
    }

    const user = (await res.json()) as SessionUser & { csrfToken?: string };
    // Session-bound CSRF token for this page's lifetime. Every state-changing request
    // echoes it in X-CSRF-Token; the server holds the matching secret in an httpOnly
    // cookie. Only issued for cookie-authenticated callers, so it is absent for a Bearer
    // client and `withCsrfHeader` then simply adds nothing.
    setCsrfToken(user.csrfToken ?? null);
    setUser({
      sub: user.sub,
      email: user.email,
      name: user.name,
      roles: user.roles,
      permissions: user.permissions,
    });
  } catch {
    // Network failure — treated as unauthenticated so the router can show the login
    // page rather than a blank shell.
    clear();
  } finally {
    setReady(true);
  }
}
