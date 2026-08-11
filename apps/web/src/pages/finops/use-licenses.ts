import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/types';

/**
 * The licence reads, THROUGH THE GENERATED CLIENT.
 *
 * They did not go through it. This screen called `sessionFetch` with hand-built URLs and declared its
 * own `SoftwareLicense`, `LicenseUtilization` and `PagedResult` interfaces under a comment saying
 * "until openapi-typescript regenerated" — and the routes have been in the generated client for a
 * while, so the workaround had outlived its reason and become a second source of truth.
 *
 * IT HAD ALREADY DRIFTED, with a user-visible consequence. The hand-written `PagedResult` put `total`
 * at the top level; the API returns it inside `pageInfo`. So `total` was always `undefined → 0`, the
 * "Licences tracked" tile always read 0, and the pager — gated on `total > 0` — never rendered at all,
 * which made every licence past the first page unreachable. Generated types would not have compiled.
 */

export type SoftwareLicense = components['schemas']['LicenseResponseDto'];
export type LicenseUtilization = components['schemas']['LicenseUtilizationDto'];

export function useLicenses(search: string, limit: number, offset: number) {
  return useQuery({
    queryKey: ['licenses', 'list', search, limit, offset],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/licenses', {
        params: { query: { search: search || undefined, limit, offset } },
      });
      if (error || !data) throw new Error('Failed to load licenses');
      return data;
    },
    // Keeps the previous page on screen while the next one loads, so the table does not blink through
    // its empty state on every page change.
    placeholderData: (prev) => prev,
  });
}

export function useUtilization() {
  return useQuery({
    queryKey: ['licenses', 'utilization'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/licenses/utilization');
      if (error || !data) throw new Error('Failed to load utilization');
      return data;
    },
  });
}
