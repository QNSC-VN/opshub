import { create } from 'zustand';

interface AuthState {
  /** Short-lived access JWT. Stored in memory only — never persisted to localStorage. */
  token: string | null;
  setToken: (token: string | null) => void;
  clear: () => void;
}

/**
 * In-memory auth store.
 *
 * The access token lives only in JS heap — cleared on page reload.
 * The refresh token lives in an HttpOnly cookie; `POST /v1/auth/refresh` is
 * called on app mount to silently restore a new access token from the cookie.
 */
export const useAuthStore = create<AuthState>()((set) => ({
  token: null,
  setToken: (token) => set({ token }),
  clear: () => set({ token: null }),
}));

export function getToken(): string | null {
  return useAuthStore.getState().token;
}

