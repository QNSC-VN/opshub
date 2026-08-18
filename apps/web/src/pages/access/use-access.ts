import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { AccessGrantResponse, AccessRequestStatus } from '@/shared/api/types';

/**
 * Every read the access screen makes.
 *
 * Keys start `['access-requests', …]`, so one invalidation after a transition refreshes the request list
 * and the caller's own grants together — approving the final step ISSUES a grant, and revoking one is the
 * other half of the same record.
 */

export function useAccessRequests(status: AccessRequestStatus | '', limit: number, offset: number) {
  return useQuery({
    // The offset is part of the key: without it React Query serves page 1 from cache for every page.
    queryKey: ['access-requests', 'list', status, limit, offset],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/access-requests', {
        params: { query: { status: (status || undefined) as never, limit, offset } },
      });
      if (error || !data) throw new Error('Failed to load access requests');
      return data;
    },
  });
}

/**
 * The privileged access the CALLER currently holds.
 *
 * SELF-SCOPED AT THE API, not filtered here: the route is `grants/me/active` and takes no id, so there is
 * no way for this to ask about somebody else. That is why it needs no permission — "what am I holding right
 * now" is a question everybody is entitled to ask about themselves, and the answer is the one thing missing
 * from a screen otherwise devoted to asking for more.
 *
 * ACTIVE MEANS UNREVOKED AND UNEXPIRED, decided by the database (`revoked_at IS NULL AND expires_at >
 * now()`). So a grant leaving this list is the window closing, and nothing here has to compute that — which
 * matters, because a client clock that disagreed would show access somebody no longer has.
 */
export function useMyGrants() {
  return useQuery<AccessGrantResponse[]>({
    queryKey: ['access-requests', 'grants', 'me'],
    /*
     * REFETCHED EVERY MINUTE, which is unusual on this codebase and deliberate here.
     *
     * The panel prints how long is LEFT, and that label is computed at render — so on a tab left open it
     * would drift from "47m left" to a number that is quietly wrong about privileged access. The refetch
     * also drops a grant the moment its window closes, decided by the database rather than by a client
     * clock. One request a minute on one screen is cheaper than a screen that claims access somebody no
     * longer holds.
     */
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/access-requests/grants/me/active');
      if (error || !data) throw new Error('Failed to load your active access');
      return data;
    },
  });
}
