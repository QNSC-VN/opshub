import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BookOpenCheck } from 'lucide-react';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import { formatDate } from '@/shared/lib/format';
import { Badge, PanelAction, humanizeStatus } from '@/shared/ui';
import { useOutstandingAcknowledgements } from './use-documents';

/**
 * What the reader still has to acknowledge.
 *
 * WHY IT IS ON THIS SCREEN. Acknowledgements are keyed on the VERSION, so publishing a revision puts a
 * document back on everybody's list — and the only useful place to be told that is where the text can be
 * read and the acknowledgement given. A notification that says "you owe an acknowledgement" and links
 * nowhere is a notification people dismiss.
 *
 * SELF-SCOPED, no permission code: it is a list keyed on the caller's own id, so every employee sees their
 * own and nobody sees anybody else's. Renders only when there is something owed.
 */
export function OutstandingAcknowledgementsBanner({
  onOpenDocument,
}: {
  /** Opens the document's drawer, where the text and the version history are. */
  onOpenDocument: (documentId: string) => void;
}) {
  const outstanding = useOutstandingAcknowledgements();
  const queryClient = useQueryClient();
  const rows = outstanding.data ?? [];

  const acknowledge = useMutation({
    mutationFn: async (versionId: string) => {
      const { error } = await api.POST('/v1/documents/versions/{id}/acknowledge', {
        params: { path: { id: versionId } },
      });
      if (error) throw new Error(apiErrorMessage(error, 'Failed to record your acknowledgement.'));
    },
    onSuccess: () => {
      toast.success('Acknowledgement recorded');
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-warning bg-warning-bg/40 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
        <BookOpenCheck className="h-3.5 w-3.5" strokeWidth={2} />
        You have {rows.length} document(s) to acknowledge
      </p>
      <ul className="mt-1 flex flex-col gap-1">
        {rows.slice(0, 6).map((row) => (
          <li key={row.versionId} className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-mono text-fg-muted">{row.code}</span>
            <span className="text-fg-muted">{row.title}</span>
            <Badge tone="neutral">{humanizeStatus(row.category)}</Badge>
            <span className="text-fg-subtle">
              v{row.version} · published {formatDate(row.publishedAt)}
            </span>
            {/* READ first, then acknowledge. Both are offered, in that order, because acknowledging
                without opening the text is the box-ticking the requirement exists to prevent. */}
            <span className="ml-auto flex items-center gap-1">
              <PanelAction onClick={() => onOpenDocument(row.documentId)}>Read</PanelAction>
              <PanelAction
                tone="accent"
                onClick={() => acknowledge.mutate(row.versionId)}
                disabled={acknowledge.isPending}
              >
                I have read this
              </PanelAction>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
