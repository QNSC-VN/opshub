import {
  PublicClientApplication,
  type AuthenticationResult,
  type AccountInfo,
  InteractionRequiredAuthError,
} from '@azure/msal-browser';

/**
 * Entra ID (Azure AD) MSAL configuration.
 *
 * Set VITE_ENTRA_TENANT_ID and VITE_ENTRA_CLIENT_ID in your .env.local file:
 *
 *   VITE_ENTRA_TENANT_ID=<your-tenant-id>
 *   VITE_ENTRA_CLIENT_ID=<your-app-registration-client-id>
 *
 * Both values are non-secret (safe to embed in SPA bundles).
 */
const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID as string | undefined;
const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID as string | undefined;

/** True when Entra SSO is configured via env vars. */
export const isSsoConfigured = !!(tenantId && clientId);

const msalConfig = {
  auth: {
    clientId: clientId ?? 'not-configured',
    authority: tenantId
      ? `https://login.microsoftonline.com/${tenantId}`
      : 'https://login.microsoftonline.com/common',
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    // sessionStorage: cleared on tab close, not accessible by XSS on other tabs.
    cacheLocation: 'sessionStorage' as const,
    storeAuthStateInCookie: false,
  },
};

let _instance: PublicClientApplication | null = null;
let _initPromise: Promise<void> | null = null;

function getInstance(): PublicClientApplication {
  if (!_instance) _instance = new PublicClientApplication(msalConfig);
  return _instance;
}

async function ensureInitialized(): Promise<PublicClientApplication> {
  const instance = getInstance();
  if (!_initPromise) _initPromise = instance.initialize();
  await _initPromise;
  return instance;
}

/**
 * Trigger a full-page redirect to Microsoft.
 * Called by the router's `beforeLoad` when the user is unauthenticated and
 * SSO is configured — the user never sees an OpsHub login page.
 *
 * Clears stale MSAL interaction state first to prevent `interaction_in_progress`
 * errors when a previous redirect was abandoned (e.g., tab closed mid-flow).
 */
export async function triggerLogin(): Promise<void> {
  const instance = await ensureInitialized();
  // Clear any stale state from a previous abandoned redirect before starting a new one.
  await instance.handleRedirectPromise({ navigateToLoginRequestUrl: false }).catch(() => null);
  await instance.loginRedirect({
    scopes: ['openid', 'profile', 'email'],
    prompt: 'select_account',
  });
  // loginRedirect navigates away — code after this line never runs.
}

/**
 * Must be called once on every app boot (before the router runs).
 * Returns the AuthenticationResult if returning from a Microsoft redirect, or null.
 *
 * `navigateToLoginRequestUrl: false` keeps the app at the redirectUri (origin root)
 * after processing instead of navigating to the pre-redirect URL, which would re-trigger
 * the auth guard and cause a redirect loop.
 */
export async function handleSsoRedirect(): Promise<AuthenticationResult | null> {
  const instance = await ensureInitialized();
  try {
    return await instance.handleRedirectPromise({ navigateToLoginRequestUrl: false });
  } catch {
    // Redirect errors are non-fatal — user may have cancelled or navigated away
    return null;
  }
}

/**
 * Attempt a silent Entra token refresh for the active account.
 * Returns the idToken string, or null if no active MSAL session.
 * Falls back to interactive login if the silent refresh fails.
 */
export async function acquireSsoTokenSilent(): Promise<string | null> {
  const instance = await ensureInitialized();
  const accounts = instance.getAllAccounts();
  if (accounts.length === 0) return null;

  try {
    const result = await instance.acquireTokenSilent({
      scopes: ['openid', 'profile', 'email'],
      account: accounts[0] as AccountInfo,
    });
    return result.idToken;
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      await triggerLogin();
    }
    return null;
  }
}

/**
 * Full Microsoft sign-out redirect.
 * Use when you want to also invalidate the Microsoft session (enterprise sign-out).
 */
export async function msalLogoutRedirect(postLogoutUri: string): Promise<void> {
  const instance = await ensureInitialized();
  await instance.logoutRedirect({ postLogoutRedirectUri: postLogoutUri });
}

/**
 * Clear the local MSAL session cache without redirecting to Microsoft.
 * Called on OpsHub logout so the next sign-in shows the account picker.
 */
export async function clearSsoSession(): Promise<void> {
  const instance = await ensureInitialized();
  await instance.clearCache().catch(() => null);
  instance.setActiveAccount(null);
}
