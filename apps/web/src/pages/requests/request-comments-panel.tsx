import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import { Button, Textarea } from '@/shared/ui';
import { formatDateTime } from '@/shared/lib/format';
import { useRequestComments } from './use-requests';

/** The API's own ceiling, from `AddCommentSchema`. Stated here so the box stops rather than 400s. */
const MAX_BODY = 5000;

/**
 * The discussion on a request.
 *
 * WHY THIS IS SEPARATE FROM THE ACTIVITY TIMELINE ABOVE IT. The trail is what the SYSTEM recorded and
 * nothing can write to it; this is what PEOPLE said — "which cost centre does this go against?" — and it is
 * the only place on a request where a question can be asked before a decision is made. Without it the only
 * channel between requester and approver was the rejection note, which arrives after the answer.
 *
 * IT STAYS OPEN AFTER RESOLUTION, deliberately, because the API does: `addComment` checks that the caller
 * is a party to the request and checks nothing about its status. "This was rejected because the budget code
 * was wrong, here is the right one" is a comment worth having on a closed request, and closing the box would
 * refuse a write the server would have accepted.
 *
 * WHO MAY POST is decided by the service — `assertParty` over the requester and the assignee, else
 * `request.read` — so this asks nobody's permission up front and shows the API's refusal if there is one.
 * The list would not have loaded for somebody who cannot read the request at all.
 */
export function RequestCommentsPanel({ requestId }: { requestId: string }) {
  const qc = useQueryClient();
  const thread = useRequestComments(requestId);
  const [body, setBody] = useState('');
  const comments = thread.data ?? [];

  const post = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST('/v1/requests/{id}/comments', {
        params: { path: { id: requestId } },
        body: { body: body.trim() },
      });
      if (error) throw new Error(apiErrorMessage(error, 'Failed to post the comment.'));
    },
    onSuccess: () => {
      setBody('');
      // ONLY THE THREAD. A comment changes no request state — the API says so — so invalidating the whole
      // `['requests']` prefix would refetch a page of rows to learn nothing.
      void qc.invalidateQueries({ queryKey: ['requests', 'comments', requestId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col gap-3">
      {thread.isLoading && <p className="text-xs text-fg-subtle">Loading…</p>}
      {thread.isError && <p className="text-xs text-danger">Failed to load the comments.</p>}
      {!thread.isLoading && !thread.isError && comments.length === 0 && (
        <p className="text-xs text-fg-subtle">No comments yet</p>
      )}

      {comments.map((comment) => (
        <div
          key={comment.id}
          className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs"
        >
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-fg-muted">{comment.authorId}</span>
            <span className="text-fg-subtle">{formatDateTime(comment.createdAt)}</span>
            {/* The API carries `editedAt`; an edited comment that looked unedited would be the one thing
                a thread must not hide. There is no route to edit one yet, so this is a reader only. */}
            {comment.editedAt && <span className="text-fg-subtle">· edited</span>}
          </div>
          <p className="mt-0.5 whitespace-pre-wrap text-fg">{comment.body}</p>
        </div>
      ))}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          post.mutate();
        }}
        className="flex flex-col gap-2"
      >
        <Textarea
          rows={2}
          value={body}
          maxLength={MAX_BODY}
          onChange={(e) => setBody(e.target.value)}
          aria-label="Add a comment"
          placeholder="Add a comment…"
        />
        <div className="flex justify-end">
          {/* Disabled on WHITESPACE too: the API trims and then refuses an empty body, so a spaces-only
              submit is a round trip whose only outcome is an error message. */}
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={post.isPending || !body.trim()}
          >
            {post.isPending ? 'Posting…' : 'Post comment'}
          </Button>
        </div>
      </form>
    </div>
  );
}
