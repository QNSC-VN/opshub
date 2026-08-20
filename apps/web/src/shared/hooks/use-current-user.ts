/**
 * useCurrentUser — thin wrapper around the /me query.
 *
 * Provides the authenticated employee record to any component.
 * Kept separate from auth-store so it can be used independently.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { STALE } from '@/shared/api/cache';
import type { components } from '@/shared/api/generated/api';

export type MeDto = components['schemas']['MeResponseDto'];

/**
 * The cache entry for the signed-in principal.
 *
 * Exported because THREE places addressed it by writing the array out: this hook, the profile page's
 * own copy of this hook, and now the auth bootstrap, which seeds it. A key spelled in three files is a
 * cache miss waiting for a typo — and a miss here is a duplicate request on every page load.
 */
export const ME_QUERY_KEY = ['auth', 'me'] as const;

/**
 * The signed-in principal.
 *
 * SEEDED BY THE BOOTSTRAP, so this normally does not fetch. `bootstrapAuth` already calls
 * `GET /v1/auth/me` before React mounts — it has to, because the router guard cannot run until the
 * session is known — and used to throw the response body away after copying five fields into the auth
 * store. This hook then asked for the same document again, so every page load paid for it twice.
 */
export function useCurrentUser() {
  return useQuery<MeDto>({
    queryKey: ME_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/auth/me');
      if (error || !data) throw new Error('Failed to load user');
      return data as MeDto;
    },
    staleTime: STALE.REPORT,
    retry: 1,
  });
}
