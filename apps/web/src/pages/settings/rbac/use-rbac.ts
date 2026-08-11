import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { PermissionResponse, RoleResponse } from '@/shared/api/types';

/**
 * The two reads every RBAC tab shares.
 *
 * Their own module, not `rbac-shared.tsx`: that file exports COMPONENTS, and eslint's
 * `react-refresh/only-export-components` is right that mixing hooks in costs Fast Refresh for them.
 */

export function useRoles() {
  return useQuery<RoleResponse[]>({
    queryKey: ['authz', 'roles'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/authz/roles');
      if (error || !data) throw new Error('Failed to load roles');
      return data as RoleResponse[];
    },
  });
}

export function usePermissions() {
  return useQuery<PermissionResponse[]>({
    queryKey: ['authz', 'permissions'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/authz/permissions');
      if (error || !data) throw new Error('Failed to load permissions');
      return data as PermissionResponse[];
    },
  });
}
