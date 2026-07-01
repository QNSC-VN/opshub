/**
 * useCurrentUser — thin wrapper around the /me query.
 *
 * Provides the authenticated employee record to any component.
 * Kept separate from auth-store so it can be used independently.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/api';

export type MeDto = components['schemas']['MeResponseDto'];

export function useCurrentUser() {
  return useQuery<MeDto>({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/auth/me');
      if (error || !data) throw new Error('Failed to load user');
      return data as MeDto;
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
