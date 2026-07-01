/**
 * RequestsPage — unified approval inbox.
 *
 * Shows all request items across types (access, leave, overtime, onboarding…).
 * Approvers can filter by "My queue" (pending items where they're the assignee),
 * review each item, and approve/reject from an inline note modal.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox, Check, X, AlertTriangle, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { SlideOver, SlideOverSection } from '@/shared/ui/slide-over';
import { ActivityTimeline } from '@/shared/ui/activity-timeline';
import type { RequestItemResponse, RequestStatus, RequestPriority } from '@/shared/api/types';

// ── Config ────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: 'Pending',
  in_review: 'In Review',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

const STATUS_CLASS: Record<RequestStatus, string> = {
  pending: 'bg-warning-bg text-warning',
  in_review: 'bg-accent-muted text-accent',
  approved: 'bg-success-bg text-success',
  rejected: 'bg-danger-bg text-danger',
  cancelled: 'bg-surface-muted text-fg-muted',
  expired: 'bg-surface-muted text-fg-subtle',
};

const PRIORITY_CLASS: Record<RequestPriority, string> = {
  low: 'text-fg-subtle',
  normal: 'text-fg-muted',
  high: 'text-warning',
  urgent: 'text-danger',
};

const PRIORITY_DOT: Record<RequestPriority, string> = {
  low: 'bg-border-strong',
  normal: 'bg-fg-subtle',
  high: 'bg-warning-bg0',
  urgent: 'bg-danger-bg0',
};

const REQUEST_TYPE_LABEL: Record<string, string> = {
  access_request: 'Access Request',
  leave_request: 'Leave',
  overtime: 'Overtime',
  onboarding: 'Onboarding',
  offboarding: 'Offboarding',
};

const STATUS_TABS: { value: RequestStatus | 'my_queue' | ''; label: string }[] = [
  { value: 'my_queue', label: 'My Queue' },
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_review', label: 'In Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isSlaAtRisk(req: RequestItemResponse): boolean {
  if (!req.slaDeadline || req.status !== 'pending' && req.status !== 'in_review') return false;
  const remaining = new Date(req.slaDeadline).getTime() - Date.now();
  return remaining < 8 * 3_600_000 && remaining > 0; // < 8 h left
}

function isSlaBreached(req: RequestItemResponse): boolean {
  return !!req.slaBreachedAt;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useRequests(filter: RequestStatus | 'my_queue' | '') {
  return useQuery<{ data: RequestItemResponse[]; total: number }>({
    queryKey: ['requests', 'list', filter],
    queryFn: async () => {
      const params: Record<string, string | number | boolean> = { limit: 50 };
      if (filter === 'my_queue') {
        params['myQueue'] = true;
      } else if (filter) {
        params['status'] = filter;
      }
      const { data, error } = await api.GET('/v1/requests', {
        params: { query: params as never },
      });
      if (error || !data) throw new Error('Failed to load requests');
      return data as unknown as { data: RequestItemResponse[]; total: number };
    },
  });
}

// ── Review modal ──────────────────────────────────────────────────────────────

interface ReviewModalProps {
  request: RequestItemResponse;
  action: 'approve' | 'reject';
  onClose: () => void;
  onSuccess: () => void;
}

function ReviewModal({ request, action, onClose, onSuccess }: ReviewModalProps) {
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const typeLabel = REQUEST_TYPE_LABEL[request.type] ?? request.type;
  const isApprove = action === 'approve';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isApprove && !note.trim()) { setErr('A reason is required for rejection.'); return; }
    setLoading(true);
    setErr('');

    const endpoint = isApprove ? '/v1/requests/{id}/approve' : '/v1/requests/{id}/reject';
    const { error } = await api.POST(endpoint, {
      params: { path: { id: request.id } },
      body: { note: note.trim() || undefined },
    });
    setLoading(false);
    if (error) { setErr('Failed to process request. Please try again.'); return; }

    toast.success(isApprove ? 'Request approved' : 'Request rejected');
    onSuccess();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-fg">
            {isApprove ? 'Approve' : 'Reject'} {typeLabel}
          </h2>
          <button onClick={onClose} className="rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Request summary */}
        <div className="mx-5 mt-4 rounded-lg bg-surface-muted p-3 text-xs text-fg-muted space-y-1">
          <div className="flex justify-between">
            <span className="text-fg-subtle">Type</span>
            <span className="font-medium">{typeLabel}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-fg-subtle">Step</span>
            <span className="font-medium">{request.currentStep} / {request.totalSteps}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-fg-subtle">Submitted</span>
            <span className="font-medium">{formatDate(request.submittedAt)}</span>
          </div>
          {request.slaDeadline && (
            <div className="flex justify-between">
              <span className="text-fg-subtle">SLA deadline</span>
              <span className={isSlaBreached(request) ? 'font-medium text-danger' : 'font-medium'}>
                {formatDate(request.slaDeadline)}
                {isSlaBreached(request) && ' ⚠ Breached'}
              </span>
            </div>
          )}
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">
              Note {isApprove ? '(optional)' : '*'}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder={isApprove ? 'Add an approval note…' : 'Explain why this is being rejected…'}
              className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          {err && <p className="text-xs text-danger">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button" onClick={onClose}
              className="h-8 rounded-md border border-border px-3.5 text-sm font-medium text-fg-muted hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="submit" disabled={loading}
              className={[
                'h-8 rounded-md px-3.5 text-sm font-medium text-white disabled:opacity-60',
                isApprove ? 'bg-accent hover:bg-accent-hover' : 'bg-red-600 hover:bg-red-700',
              ].join(' ')}
            >
              {loading ? 'Processing…' : isApprove ? 'Approve' : 'Reject'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Expandable row ────────────────────────────────────────────────────────────

interface RequestRowProps {
  req: RequestItemResponse;
  onAction: (req: RequestItemResponse, action: 'approve' | 'reject') => void;
  onSelect: (req: RequestItemResponse) => void;
}

function RequestRow({ req, onAction, onSelect }: RequestRowProps) {
  const typeLabel = REQUEST_TYPE_LABEL[req.type] ?? req.type;
  const status = req.status as RequestStatus;
  const priority = req.priority as RequestPriority;
  const atRisk = isSlaAtRisk(req);
  const breached = isSlaBreached(req);
  const isActionable = status === 'pending' || status === 'in_review';

  return (
    <tr
      className="border-b border-border hover:bg-surface-hover cursor-pointer"
      onClick={() => onSelect(req)}
    >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <div>
              <p className="text-sm font-medium text-fg">{typeLabel}</p>
              <p className="text-xs text-fg-subtle font-mono">{req.id.slice(0, 8)}…</p>
            </div>
          </div>
        </td>
        <td className="px-4 py-3">
          <span className={['inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium', STATUS_CLASS[status]].join(' ')}>
            {STATUS_LABEL[status]}
            {req.totalSteps > 1 && isActionable && (
              <span className="opacity-60">· {req.currentStep}/{req.totalSteps}</span>
            )}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className={['h-1.5 w-1.5 rounded-full shrink-0', PRIORITY_DOT[priority]].join(' ')} />
            <span className={['text-xs capitalize', PRIORITY_CLASS[priority]].join(' ')}>{priority}</span>
          </div>
        </td>
        <td className="px-4 py-3 text-xs text-fg-muted">{formatDate(req.submittedAt)}</td>
        <td className="px-4 py-3">
          {(atRisk || breached) && (
            <span className={['inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium', breached ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning'].join(' ')}>
              <AlertTriangle className="h-3 w-3" strokeWidth={2} />
              {breached ? 'Breached' : 'At risk'}
            </span>
          )}
          {!atRisk && !breached && req.slaDeadline && isActionable && (
            <span className="inline-flex items-center gap-1 text-xs text-fg-subtle">
              <Clock className="h-3 w-3" strokeWidth={1.75} />
              Due {formatDate(req.slaDeadline)}
            </span>
          )}
        </td>
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          {isActionable && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => onAction(req, 'approve')}
                className="flex items-center gap-1 rounded-md bg-accent-muted px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent-muted"
              >
                <Check className="h-3 w-3" strokeWidth={2.5} />
                Approve
              </button>
              <button
                onClick={() => onAction(req, 'reject')}
                className="flex items-center gap-1 rounded-md bg-danger-bg px-2.5 py-1 text-xs font-medium text-danger hover:bg-danger-bg"
              >
                <X className="h-3 w-3" strokeWidth={2.5} />
                Reject
              </button>
            </div>
          )}
        </td>
      </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function RequestsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<RequestStatus | 'my_queue' | ''>('my_queue');
  const [modal, setModal] = useState<{ req: RequestItemResponse; action: 'approve' | 'reject' } | null>(null);
  const [selected, setSelected] = useState<RequestItemResponse | null>(null);

  const { data, isLoading, isError } = useRequests(tab);
  const rows = data?.data ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ['requests'] });

  return (
    <>
      {modal && (
        <ReviewModal
          request={modal.req}
          action={modal.action}
          onClose={() => setModal(null)}
          onSuccess={invalidate}
        />
      )}

      <div className="flex flex-col gap-5">
        {/* Header */}
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-fg">Requests Inbox</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            Unified approval queue across all request types.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-lg bg-surface-muted p-1 w-fit">
          {STATUS_TABS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={[
                'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                tab === value ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg-muted',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted">
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Request</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Priority</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Submitted</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">SLA</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-fg-subtle">Loading…</td>
                </tr>
              )}
              {isError && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-danger">Failed to load requests.</td>
                </tr>
              )}
              {!isLoading && !isError && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center">
                    <Inbox className="mx-auto h-8 w-8 text-fg-subtle" strokeWidth={1.5} />
                    <p className="mt-2 text-sm text-fg-subtle">No requests found</p>
                  </td>
                </tr>
              )}
              {rows.map((req) => (
                <RequestRow
                  key={req.id}
                  req={req}
                  onAction={(r, a) => setModal({ req: r, action: a })}
                  onSelect={setSelected}
                />
              ))}
            </tbody>
          </table>
        </div>

        {data && (
          <p className="text-xs text-fg-subtle">
            Showing {rows.length} of {data.total} requests
          </p>
        )}
      </div>

      {/* Request detail slide-over */}
      <SlideOver
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? (REQUEST_TYPE_LABEL[selected.type] ?? selected.type) : 'Request detail'}
        description={selected ? `#${selected.id.slice(0, 8)} · ${STATUS_LABEL[selected.status as RequestStatus]}` : undefined}
        width="lg"
        headerActions={selected && (selected.status === 'pending' || selected.status === 'in_review') ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setModal({ req: selected, action: 'approve' }); setSelected(null); }}
              className="flex items-center gap-1 rounded-md bg-accent-muted px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-muted"
            >
              <Check className="h-3 w-3" strokeWidth={2.5} /> Approve
            </button>
            <button
              onClick={() => { setModal({ req: selected, action: 'reject' }); setSelected(null); }}
              className="flex items-center gap-1 rounded-md bg-danger-bg px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger-bg"
            >
              <X className="h-3 w-3" strokeWidth={2.5} /> Reject
            </button>
          </div>
        ) : undefined}
      >
        {selected && (
          <>
            <SlideOverSection title="Details">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {[
                  { label: 'Type',        value: REQUEST_TYPE_LABEL[selected.type] ?? selected.type },
                  { label: 'Status',      value: <span className={['inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', STATUS_CLASS[selected.status as RequestStatus]].join(' ')}>{STATUS_LABEL[selected.status as RequestStatus]}</span> },
                  { label: 'Priority',    value: <div className="flex items-center gap-1.5"><span className={['h-1.5 w-1.5 rounded-full', PRIORITY_DOT[selected.priority as RequestPriority]].join(' ')} /><span className="capitalize text-xs">{selected.priority}</span></div> },
                  { label: 'Submitted',   value: formatDate(selected.submittedAt) },
                  { label: 'Requester',   value: <span className="font-mono text-xs">{selected.requesterId}</span> },
                  { label: 'Assignee',    value: selected.assigneeId ? <span className="font-mono text-xs">{selected.assigneeId}</span> : <span className="text-fg-subtle">—</span> },
                  { label: 'SLA deadline', value: selected.slaDeadline ? formatDate(selected.slaDeadline) : '—' },
                  { label: 'Steps',       value: selected.totalSteps > 1 ? `Step ${selected.currentStep} of ${selected.totalSteps}` : '—' },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <dt className="text-xs text-fg-subtle">{label}</dt>
                    <dd className="mt-0.5 text-fg">{value}</dd>
                  </div>
                ))}
              </dl>
              {selected.resolutionNote && (
                <div className="mt-4 rounded-md bg-surface-muted px-3 py-2.5 text-sm text-fg-muted">
                  <p className="mb-1 text-xs text-fg-subtle">Resolution note</p>
                  {selected.resolutionNote}
                </div>
              )}
            </SlideOverSection>

            {(selected.approvals?.length ?? 0) > 0 && (
              <>
                <div className="mx-5 h-px bg-surface-muted" />
                <SlideOverSection title="Approval history">
                  <div className="flex flex-col gap-2">
                    {selected.approvals!.map((a) => (
                      <div key={a.id} className="flex items-start gap-3">
                        <span className={['mt-0.5 rounded px-1.5 py-0.5 text-xs font-medium shrink-0', a.decision === 'approved' ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'].join(' ')}>
                          Step {a.step} — {a.decision}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs text-fg-subtle">{formatDate(a.decidedAt)}</p>
                          {a.note && <p className="mt-0.5 text-xs text-fg-muted">"{a.note}"</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </SlideOverSection>
              </>
            )}

            <div className="mx-5 h-px bg-surface-muted" />

            <SlideOverSection title="Activity">
              <ActivityTimeline resourceId={selected.id} resourceType="request" />
            </SlideOverSection>
          </>
        )}
      </SlideOver>
    </>
  );
}
