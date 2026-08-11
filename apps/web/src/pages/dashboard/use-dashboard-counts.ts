import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';

/**
 * The five counts the dashboard tiles read.
 *
 * Each is `limit: 1` and takes `pageInfo.total` — the cheapest way to ask "how many" against a paged
 * endpoint, and the reason none of these needs a dedicated count route.
 *
 * `staleTime: 60_000` on all of them: a home screen that refetched five counts on every focus change
 * would be five requests for numbers nobody watches change by the second.
 */

const STALE = 60_000;

/** Every count, keyed. One hook per tile would mean each persona listing the ones it wants. */
export interface DashboardCounts {
  assets: CountResult;
  myQueue: CountResult;
  pendingAccess: CountResult;
  openFindings: CountResult;
  pendingLeave: CountResult;
}

export interface CountResult {
  data: number | undefined;
  isLoading: boolean;
}

function useTotal(key: string[], fetch: () => Promise<number>): CountResult {
  const q = useQuery({ queryKey: key, queryFn: fetch, staleTime: STALE });
  return { data: q.data, isLoading: q.isLoading };
}

/**
 * All five, always.
 *
 * Called unconditionally rather than per persona, because React hooks cannot be called conditionally
 * and a persona-specific subset would mean seven components each wiring its own — which is what the
 * page did, and it is why two personas were fetching a count they never displayed.
 */
export function useDashboardCounts(): DashboardCounts {
  return {
    assets: useTotal(['assets', 'count'], async () => {
      const { data, error } = await api.GET('/v1/assets', { params: { query: { limit: 1 } } });
      if (error || !data) throw new Error('Failed to count assets');
      return data.pageInfo?.total ?? 0;
    }),

    myQueue: useTotal(['requests', 'my-queue-count'], async () => {
      const { data, error } = await api.GET('/v1/requests', {
        params: { query: { limit: 1, mine: true, status: 'pending' } },
      });
      if (error || !data) throw new Error('Failed to count my queue');
      return data.pageInfo?.total ?? 0;
    }),

    pendingAccess: useTotal(['access-requests', 'pending-count'], async () => {
      const { data, error } = await api.GET('/v1/access-requests', {
        params: { query: { limit: 1, status: 'pending' } },
      });
      if (error || !data) throw new Error('Failed to count pending access');
      return data.pageInfo?.total ?? 0;
    }),

    openFindings: useTotal(['compliance', 'open-findings-count'], async () => {
      const { data, error } = await api.GET('/v1/compliance/findings', {
        params: { query: { limit: 1, status: 'open' } },
      });
      if (error || !data) throw new Error('Failed to count findings');
      return data.pageInfo?.total ?? 0;
    }),

    pendingLeave: useTotal(['workforce', 'pending-leave-count'], async () => {
      const { data, error } = await api.GET('/v1/workforce/leave', {
        params: { query: { limit: 1, status: 'pending' } },
      });
      if (error || !data) throw new Error('Failed to count pending leave');
      return data.pageInfo?.total ?? 0;
    }),
  };
}
