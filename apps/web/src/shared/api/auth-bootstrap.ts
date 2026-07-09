import { handleSsoRedirect, isSsoConfigured } from '@/app/auth/msal';
import { api, attemptRefresh } from './client';
import { useAuthStore } from './auth-store';

/**
 * Called once before the router mounts (in AppProviders).
 *
 * Order of operations:
 * 1. Try silent session restore from the HttpOnly refresh cookie.
 * 2. If that fails AND we're coming back from a Microsoft redirect,
 *    handle the redirect result and exchange the id_token for an internal JWT.
 *
 * After this resolves, `getToken()` is either set or null.
 * The router's `beforeLoad` then decides what to do with an unauthenticated user.
 *
 * Idempotent: multiple calls (React StrictMode double-invoke) share the same promise.
 */
let _bootstrapPromise: Promise<void> | null = null;

export function bootstrapAuth(): Promise<void> {
  if (_bootstrapPromise) return _bootstrapPromise;
  _bootstrapPromise = _run().finally(() => {
    // Allow re-run after logout (clear by calling resetBootstrap)
  });
  return _bootstrapPromise;
}

/** Call on logout so the next navigation can bootstrap again. */
export function resetBootstrap(): void {
  _bootstrapPromise = null;
}

async function _run(): Promise<void> {
  // 1. Silent restore from refresh cookie (fastest path — works on every reload).
  //    Delegate to the shared, single-flight + cross-tab-locked refresh so cold
  //    start never races the 401-retry path with the same single-use cookie
  //    (which the server would treat as token theft).
  const token = await attemptRefresh();
  if (token) return;

  // 2. If SSO is configured, check if we're returning from a Microsoft redirect.
  //    handleSsoRedirect() uses navigateToLoginRequestUrl: false, so MSAL stays
  //    at the redirectUri instead of navigating back to the pre-redirect URL.
  if (!isSsoConfigured) return;

  const result = await handleSsoRedirect();
  if (!result?.idToken) return;

  try {
    const { data } = await api.POST('/v1/auth/entra-login', {
      body: { idToken: result.idToken },
    });
    if (data?.accessToken) {
      useAuthStore.getState().setToken(data.accessToken);
    }
  } catch {
    // Entra login API failed — user unauthenticated, router will redirect to login
  }
}
