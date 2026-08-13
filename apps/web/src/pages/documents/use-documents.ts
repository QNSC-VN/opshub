import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { AcknowledgedBy, DocumentVersion, OutstandingAcknowledgement } from './document.types';

/**
 * Every read the document library makes.
 *
 * Keys start `['documents', …]`. Publishing a version supersedes another, changes what the library row shows
 * as in force, AND changes what every employee still owes an acknowledgement on — so one prefix means one
 * invalidation, instead of a library that says v3 is published beside a banner still asking for v2.
 */

export function useDocuments(params: {
  category: string;
  includeRetired: boolean;
  search: string;
  limit: number;
  offset: number;
}) {
  const { category, includeRetired, search, limit, offset } = params;
  return useQuery({
    queryKey: ['documents', 'list', category, includeRetired, search, limit, offset],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/documents', {
        params: {
          query: {
            category: (category || undefined) as never,
            includeRetired: includeRetired || undefined,
            search: search || undefined,
            limit,
            offset,
          },
        },
      });
      if (error || !data) throw new Error('Failed to load the document library');
      return data;
    },
  });
}

/**
 * Every version of one document, newest first.
 *
 * THE HISTORY IS THE POINT. A controlled document is not its current text: it is the sequence of revisions,
 * each with who approved it and when it was in force. That is what "which policy applied on 3 March" is
 * answered from, so the drawer lists all of them rather than only the published one.
 */
export function useVersions(documentId: string | null) {
  return useQuery<DocumentVersion[]>({
    queryKey: ['documents', 'versions', documentId],
    enabled: !!documentId,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/documents/{id}/versions', {
        params: { path: { id: documentId! } },
      });
      if (error || !data) throw new Error('Failed to load the versions');
      return data;
    },
  });
}

/** Who has acknowledged a version. Read per version, because that is what an acknowledgement is keyed on. */
export function useAcknowledgements(versionId: string | null) {
  return useQuery<AcknowledgedBy[]>({
    queryKey: ['documents', 'acknowledgements', versionId],
    enabled: !!versionId,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/documents/versions/{id}/acknowledgements', {
        params: { path: { id: versionId! } },
      });
      if (error || !data) throw new Error('Failed to load the acknowledgements');
      return data;
    },
  });
}

/**
 * What the CALLER still has to acknowledge.
 *
 * Self-scoped on the API — no permission code at all — because it is a list keyed on the caller's own id.
 * Which is also why it belongs on this screen: the library is where somebody reads a policy, and being told
 * what they owe anywhere else means being told somewhere they cannot act on it.
 */
export function useOutstandingAcknowledgements() {
  return useQuery<OutstandingAcknowledgement[]>({
    queryKey: ['documents', 'outstanding'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/documents/acknowledgements/outstanding');
      if (error || !data) throw new Error('Failed to load outstanding acknowledgements');
      return data;
    },
  });
}
