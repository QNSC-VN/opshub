import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeCheck, FileText } from 'lucide-react';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import { formatDate, formatDateTime, orDash } from '@/shared/lib/format';
import { useCurrentUser } from '@/shared/hooks/use-current-user';
import { usePermissions } from '@/shared/hooks/use-permissions';
import { Badge, PanelAction, StatusBadge, humanizeStatus, statusTone } from '@/shared/ui';
import {
  VERSION_NEXT_ACTIONS,
  type ControlledDocument,
  type DocumentVersion,
} from './document.types';
import { useAcknowledgements, useVersions } from './use-documents';
import { DraftModal, PublishVersionModal } from './document-modals';

/**
 * Who has acknowledged the version in force.
 *
 * ONLY FOR THE PUBLISHED ONE, because that is the only version an acknowledgement can exist against: the
 * service refuses a draft (consenting to a proposal means nothing) and a superseded one (which would read as
 * current compliance). Shown as a count with the names behind it, since "who has not" is answered by the
 * outstanding list on each person's own screen rather than by an absence here.
 */
function AcknowledgementsPanel({ versionId }: { versionId: string }) {
  const acks = useAcknowledgements(versionId);
  const rows = acks.data ?? [];

  return (
    <div className="mt-1.5">
      {acks.isLoading && <p className="text-xs text-fg-subtle">Loading…</p>}
      {acks.isError && <p className="text-xs text-danger">Failed to load the acknowledgements.</p>}
      {!acks.isLoading && !acks.isError && (
        <p className="text-xs text-fg-subtle">
          {rows.length === 0
            ? 'Nobody has acknowledged this version yet'
            : `${rows.length} acknowledgement(s)`}
        </p>
      )}
      {rows.slice(0, 8).map((ack) => (
        <p key={ack.employeeId} className="mt-0.5 text-xs text-fg-muted">
          {/* Who signed off, by name: this list is read to answer exactly that, and a column of
              uuids cannot. */}
          <span>{orDash(ack.employeeName)}</span>
          <span className="text-fg-subtle"> · {formatDateTime(ack.acknowledgedAt)}</span>
        </p>
      ))}
    </div>
  );
}

/**
 * The revision history, and the actions each version allows.
 *
 * WHY THE HISTORY IS THE DRAWER AND NOT A TAB. A controlled document is not its current text — it is the
 * sequence of revisions with who approved each and when it was in force. "Which policy applied on 3 March"
 * is the question the register exists to answer, and it is unanswerable from a screen that shows only what
 * is current.
 *
 * NO ACTION IS OFFERED THAT THE API WOULD ONLY REFUSE. `VERSION_NEXT_ACTIONS` mirrors the service, so a
 * published version offers no edit (it is immutable), an `in_review` one offers nothing at all (the request
 * engine owns it now), and publishing is gated on `documents.publish` rather than `documents.manage` —
 * drafting a policy and putting it in force are two decisions.
 */
export function VersionHistoryPanel({ document }: { document: ControlledDocument }) {
  const versions = useVersions(document.id);
  const { can } = usePermissions();
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const [drafting, setDrafting] = useState<{ editing: DocumentVersion | null } | null>(null);
  const [publishing, setPublishing] = useState<DocumentVersion | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = versions.data ?? [];
  const canManage = can('documents.manage');
  const canPublish = can('documents.publish');
  // A retired document accepts nothing new: it is kept so a superseded control stays explainable, not so it
  // can be revised.
  const retired = !!document.retiredAt;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['documents'] });
  }

  const submit = useMutation({
    mutationFn: async (versionId: string) => {
      const { error } = await api.POST('/v1/documents/versions/{id}/submit', {
        params: { path: { id: versionId } },
      });
      if (error) throw new Error(apiErrorMessage(error, 'Failed to submit the draft.'));
    },
    onSuccess: () => {
      toast.success('Draft submitted for approval');
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Acknowledging is self-scoped and idempotent: a second click is the same acknowledgement. */
  const acknowledge = useMutation({
    mutationFn: async (versionId: string) => {
      const { data, error } = await api.POST('/v1/documents/versions/{id}/acknowledge', {
        params: { path: { id: versionId } },
      });
      if (error) throw new Error(apiErrorMessage(error, 'Failed to record your acknowledgement.'));
      return data;
    },
    onSuccess: (data) => {
      toast.success(
        data?.alreadyAcknowledged ? 'Already acknowledged' : 'Acknowledgement recorded',
      );
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col gap-2">
      {versions.isLoading && <p className="text-xs text-fg-subtle">Loading…</p>}
      {versions.isError && <p className="text-xs text-danger">Failed to load the versions.</p>}

      {rows.map((version) => {
        const steps = VERSION_NEXT_ACTIONS[version.status] ?? [];
        const inForce = version.status === 'published' && !version.supersededAt;
        const open = expanded === version.id;

        return (
          <article
            key={version.id}
            aria-label={`Version ${version.version}`}
            className="rounded-md border border-border bg-surface px-2.5 py-2"
          >
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs font-medium text-fg">v{version.version}</span>
              <StatusBadge tone={statusTone(version.status)}>
                {humanizeStatus(version.status)}
              </StatusBadge>
              {/* "In force" is not the same as "published": a published version that has been superseded is
                  history, and reading it as current is the mistake the badge exists to prevent. */}
              {inForce && (
                <Badge tone="green">
                  <BadgeCheck className="h-3 w-3" aria-hidden="true" /> In force
                </Badge>
              )}
              <span className="ml-auto text-xs text-fg-subtle">
                {version.publishedAt
                  ? `Published ${formatDate(version.publishedAt)}`
                  : `Created ${formatDate(version.createdAt)}`}
              </span>
            </div>

            {version.changeSummary && (
              <p className="mt-1 whitespace-pre-wrap text-xs text-fg-muted">
                {version.changeSummary}
              </p>
            )}

            <p className="mt-0.5 text-xs text-fg-subtle">
              {version.approvedAt
                ? `Approved ${formatDate(version.approvedAt)} by ${orDash(version.approvedBy)}`
                : version.status === 'in_review'
                  ? 'With the approvers — the request engine owns it until they decide'
                  : 'Not approved'}
              {version.reviewDueOn && ` · review due ${formatDate(version.reviewDueOn)}`}
              {version.supersededAt && ` · superseded ${formatDate(version.supersededAt)}`}
            </p>

            {/* The TEXT, behind a toggle. Acknowledging a policy without being able to read it on the same
                screen is a tick-box; the body is what makes the acknowledgement mean anything. */}
            {version.body && (
              <div className="mt-1.5">
                <PanelAction onClick={() => setExpanded(open ? null : version.id)}>
                  <FileText className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                  {open ? 'Hide text' : 'Read text'}
                </PanelAction>
                {open && (
                  <p className="mt-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-surface-muted px-2.5 py-2 text-xs text-fg-muted">
                    {version.body}
                  </p>
                )}
              </div>
            )}

            {inForce && <AcknowledgementsPanel versionId={version.id} />}

            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {steps.includes('edit') && canManage && !retired && (
                <PanelAction tone="accent" onClick={() => setDrafting({ editing: version })}>
                  Edit draft
                </PanelAction>
              )}
              {steps.includes('submit') && canManage && !retired && (
                <PanelAction onClick={() => submit.mutate(version.id)} disabled={submit.isPending}>
                  Submit for approval
                </PanelAction>
              )}
              {steps.includes('publish') && canPublish && !retired && (
                <PanelAction tone="success" onClick={() => setPublishing(version)}>
                  Publish
                </PanelAction>
              )}
              {/* Only the version IN FORCE can be acknowledged, and anybody may — no permission code at
                  all, because it records the caller as having read it. */}
              {steps.includes('acknowledge') && inForce && !!me.data && (
                <PanelAction
                  tone="accent"
                  onClick={() => acknowledge.mutate(version.id)}
                  disabled={acknowledge.isPending}
                >
                  I have read this
                </PanelAction>
              )}
            </div>
          </article>
        );
      })}

      {canManage && !retired && (
        <div>
          <PanelAction tone="accent" onClick={() => setDrafting({ editing: null })}>
            New draft
          </PanelAction>
        </div>
      )}
      {retired && (
        <p className="text-xs text-fg-subtle">
          Retired {formatDate(document.retiredAt)}. Kept so a superseded control stays explainable,
          and accepts no new revision.
        </p>
      )}

      {drafting && (
        <DraftModal
          document={document}
          editing={drafting.editing}
          onClose={() => setDrafting(null)}
          onSuccess={refresh}
        />
      )}
      {publishing && (
        <PublishVersionModal
          version={publishing}
          onClose={() => setPublishing(null)}
          onSuccess={refresh}
        />
      )}
    </div>
  );
}
