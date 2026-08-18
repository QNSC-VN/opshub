import { useQuery } from '@tanstack/react-query';
import { api } from './client';

/**
 * The DOWNLOAD URL for a file already attached to a record, per entity.
 *
 * WHY THESE EXIST. The upload flow attaches a file and the confirm response says where it landed — but
 * nothing re-read that on the next visit, so every attachment vanished from the screen on reload. The
 * widget shows a local base64 preview of the file just chosen, which is why the gap survived: upload one
 * and it appears, come back and the record looks empty while the object sits in storage.
 *
 * GROUPED HERE, like `picker-sources.ts`, rather than one hook per page. Three endpoints answer the same
 * question in the same shape and each names its key after the thing — `photoUrl`, `avatarUrl`,
 * `documentUrl`. A generic helper over a string path would have to give up the generated types to cover
 * all three, so they stay separate functions in one file: typed calls, one place to look.
 *
 * THE URL IS TIME-LIMITED — a presigned GET, per the routes' own summaries. `staleTime` is therefore
 * deliberately short of any plausible expiry rather than Infinity: a cached URL that has expired renders
 * a broken image, which is worse than fetching again.
 */

/** Well inside the shortest presign window the API issues, so a cached URL is never a dead one. */
const URL_STALE_TIME = 60_000;

function attachmentQuery<T extends string>(
  tag: T,
  id: string | null,
  read: (id: string) => Promise<string | null>,
) {
  return {
    queryKey: ['attachment-url', tag, id] as const,
    enabled: !!id,
    staleTime: URL_STALE_TIME,
    queryFn: () => read(id!),
  };
}

/** The photo on a hardware asset. */
export function useAssetPhotoUrl(assetId: string | null) {
  return useQuery<string | null>(
    attachmentQuery('asset-photo', assetId, async (id) => {
      const { data, error } = await api.GET('/v1/assets/{id}/photo', {
        params: { path: { id } },
      });
      if (error) throw new Error('Failed to load the asset photo');
      return data?.photoUrl ?? null;
    }),
  );
}

/** An employee's avatar. */
export function useEmployeeAvatarUrl(employeeId: string | null) {
  return useQuery<string | null>(
    attachmentQuery('employee-avatar', employeeId, async (id) => {
      const { data, error } = await api.GET('/v1/employees/{id}/avatar', {
        params: { path: { id } },
      });
      if (error) throw new Error('Failed to load the avatar');
      return data?.avatarUrl ?? null;
    }),
  );
}

/** The supporting document on a leave request — a fit note, a certificate. */
export function useLeaveDocumentUrl(leaveRequestId: string | null) {
  return useQuery<string | null>(
    attachmentQuery('leave-document', leaveRequestId, async (id) => {
      const { data, error } = await api.GET('/v1/workforce/leave-requests/{id}/document', {
        params: { path: { id } },
      });
      if (error) throw new Error('Failed to load the supporting document');
      return data?.documentUrl ?? null;
    }),
  );
}
