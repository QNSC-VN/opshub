import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import type { RequestCommentResponse, RequestStatus } from '@/shared/api/types';

/**
 * Every read the requests inbox makes.
 *
 * Keys start `['requests', …]`, so invalidating that prefix after a TRANSITION — approve, reject, cancel —
 * refreshes the list and an open request's thread together.
 *
 * A POSTED COMMENT IS NARROWER THAN THAT, and the panel invalidates only the thread. The API is explicit
 * that comments "do not affect request state", so refetching the list would be a page of requests fetched
 * to learn nothing.
 */

export function useRequests(
  filter: RequestStatus | 'my_queue' | '',
  limit: number,
  offset: number,
) {
  return useQuery({
    queryKey: ['requests', 'list', filter, limit, offset],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/requests', {
        params: {
          query: {
            limit,
            offset,
            // `myQueue` is the parameter the API defines; `status` is the other filter. Exactly one of
            // them applies, which is why this is a branch rather than two optional fields.
            ...(filter === 'my_queue'
              ? { myQueue: true }
              : filter
                ? { status: filter as RequestStatus }
                : {}),
          },
        },
      });
      if (error || !data) throw new Error('Failed to load requests');
      return data;
    },
  });
}

/**
 * The discussion on one request, oldest first.
 *
 * WHY THIS IS NOT THE ACTIVITY TIMELINE. The drawer already shows the audit trail, and the two answer
 * different questions: the trail is what the SYSTEM recorded and cannot be written to, while this is what
 * PEOPLE said to each other — "which cost centre should this go against?" — and it is the only place on
 * the request where a question can be asked. The API states the same separation: comments are
 * "informational only — they do not affect request state".
 *
 * READABLE BY THE PARTIES, or by a holder of `request.read`. That is enforced in the service
 * (`assertParty` on requester and assignee), so a 403 here is the answer rather than something for this
 * screen to predict.
 */
export function useRequestComments(requestId: string | null) {
  return useQuery<RequestCommentResponse[]>({
    queryKey: ['requests', 'comments', requestId],
    enabled: !!requestId,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/requests/{id}/comments', {
        params: { path: { id: requestId! } },
      });
      if (error || !data) throw new Error('Failed to load the comments on this request');
      return data;
    },
  });
}
