import { QueryClient } from '@tanstack/react-query';
import { STALE } from './cache';

/**
 * The one query client.
 *
 * WHY IT LIVES HERE rather than inside `app-providers.tsx`. Two things outside React need it: the auth
 * bootstrap, which fetches `GET /v1/auth/me` before the tree mounts and can hand that answer to the
 * cache instead of letting a hook fetch it a second time; and the logout handler, which has to discard
 * one identity's data before another can arrive. Both were previously unable to reach it, and the first
 * of them cost every page load a duplicate request.
 *
 * A module-level singleton, as it already was — one client per browser tab is the point of a cache.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if ((error as { status?: number })?.status === 401) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
      /*
       * STATED, NOT INHERITED. This is TanStack's own behaviour, so nothing changes — but half the
       * queries in the SPA set a `staleTime` and half do not, and the half that do not were reading as
       * an omission rather than as a choice. `STALE.NONE` says the choice out loud: refetch on mount,
       * which is right for a list somebody is about to act on and wrong for a reference catalogue.
       * A query that wants otherwise names its tier from the same file.
       */
      staleTime: STALE.NONE,
    },
  },
});
