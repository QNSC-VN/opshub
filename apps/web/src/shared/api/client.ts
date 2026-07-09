import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './generated/api';
import { getToken, useAuthStore } from './auth-store';
import { ENV } from '@/shared/config/env';

/** Whether a token refresh is already in flight — prevents concurrent refresh storms. */
let refreshPromise: Promise<string | null> | null = null;

/**
 * Serialize refresh across ALL tabs of this origin via the Web Locks API. Two
 * tabs racing to refresh would each POST the same single-use cookie; the second
 * hits an already-rotated token, which the server would otherwise treat as theft
 * and revoke the whole family. Holding an exclusive lock makes tabs refresh one
 * at a time so later tabs reuse the freshly-rotated cookie. Falls back to a bare
 * call where Web Locks is unavailable (older browsers / non-secure contexts).
 */
function withRefreshLock(fn: () => Promise<string | null>): Promise<string | null> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (locks?.request) {
    return locks.request('opshub-auth-refresh', { mode: 'exclusive' }, fn);
  }
  return fn();
}

async function doRefreshOnce(): Promise<string | null> {
  try {
    const res = await fetch(`${ENV.API_BASE_URL}/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include', // send the HttpOnly cookie
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { accessToken: string };
    useAuthStore.getState().setToken(data.accessToken);
    return data.accessToken;
  } catch {
    return null;
  }
}

/**
 * Silent access-token refresh. Single-flight within this tab (`refreshPromise`)
 * and serialized across tabs (`withRefreshLock`). Exported so cold-start
 * bootstrap reuses the exact same coordinated path instead of racing its own
 * uncoordinated fetch with the same single-use cookie.
 */
export async function attemptRefresh(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      return await withRefreshLock(doRefreshOnce);
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    const token = getToken();
    if (token) request.headers.set('Authorization', `Bearer ${token}`);
    return request;
  },

  async onResponse({ response, request }) {
    if (response.status !== 401) return response;

    // Attempt a silent token refresh
    const newToken = await attemptRefresh();
    if (!newToken) {
      useAuthStore.getState().clear();
      window.location.replace('/login');
      return response;
    }

    // Retry the original request once with the new token
    const retried = new Request(request, {
      headers: new Headers(request.headers),
    });
    retried.headers.set('Authorization', `Bearer ${newToken}`);
    return fetch(retried);
  },
};

/**
 * Typed API client. In dev, `API_BASE_URL` is empty and requests are proxied to
 * the API at `/v1` (see vite.config). In prod, the SPA is on Cloudflare Pages and
 * `API_BASE_URL` points at the API origin (e.g. https://opshub-api-dev.qnsc.vn).
 */
export const api = createClient<paths>({ baseUrl: ENV.API_BASE_URL });
api.use(authMiddleware);
