import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Plus, CheckCircle, XCircle, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { SlideOver, SlideOverSection } from '@/shared/ui/slide-over';
import { ActivityTimeline } from '@/shared/ui/activity-timeline';
import type { AccessRequestResponse, AccessRequestStatus } from '@/shared/api/types';

const ACCESS_TYPE_OPTIONS = [
  { value: 'local_admin', label: 'Local Admin' },
  { value: 'pim_role', label: 'PIM Role (JIT elevation)' },
  { value: 'app_admin', label: 'App Admin' },
  { value: 'vpn', label: 'VPN' },
  { value: 'other', label: 'Other' },
] as const;
type AccessType = (typeof ACCESS_TYPE_OPTIONS)[number]['value'];

// ── Config ────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired',
};

const STATUS_CLASS: Record<string, string> = {
  pending: 'bg-warning-bg text-warning',
  approved: 'bg-success-bg text-success',
  rejected: 'bg-danger-bg text-danger',
  expired: 'bg-surface-muted text-fg-muted',
};

const STATUS_FILTERS = [
  { value: '' as const, label: 'All' },
  { value: 'pending' as const, label: 'Pending' },
  { value: 'approved' as const, label: 'Approved' },
  { value: 'rejected' as const, label: 'Rejected' },
];

const inputClass =
  'h-8 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

// ── Hook ──────────────────────────────────────────────────────────────────────

function useAccessRequests(status: AccessRequestStatus | '') {
  return useQuery({
    queryKey: ['access-requests', 'list', status],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/access-requests', {
        params: { query: { status: (status || undefined) as never, limit: 50 } },
      });
      if (error || !data) throw new Error('Failed to load access requests');
      return data;
    },
  });
}

// ── Submit modal ──────────────────────────────────────────────────────────────

interface SubmitModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function SubmitModal({ onClose, onSuccess }: SubmitModalProps) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({
    accessType: 'vpn' as AccessType,
    target: '',
    justification: '',
    durationHours: 8,
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr('');
    const { error } = await api.POST('/v1/access-requests', {
      body: {
        accessType: form.accessType,
        target: form.target,
        justification: form.justification,
        durationHours: form.durationHours,
      },
    });
    setLoading(false);
    if (error) { setErr('Failed to submit request. Please try again.'); return; }
    toast.success('Access request submitted');
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
          <h2 className="text-sm font-semibold text-fg">Request temporary access</h2>
          <button onClick={onClose} className="rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Access type *</label>
            <select
              required value={form.accessType}
              onChange={(e) => set('accessType', e.target.value as AccessType)}
              className={inputClass}
            >
              {ACCESS_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Target system / resource *</label>
            <input
              required value={form.target}
              onChange={(e) => set('target', e.target.value)}
              placeholder="e.g. prod-db-01, 10.0.0.5, s3://my-bucket"
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Justification *</label>
            <textarea
              required value={form.justification}
              onChange={(e) => set('justification', e.target.value)}
              rows={3}
              placeholder="Why do you need this access and for what purpose?"
              className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Duration (hours)</label>
            <input
              type="number" min={1} max={720} required
              value={form.durationHours}
              onChange={(e) => set('durationHours', Number(e.target.value))}
              className={inputClass}
            />
            <p className="text-xs text-fg-subtle">Maximum 720 hours (30 days). Access is automatically revoked after expiry.</p>
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
              className="h-8 rounded-md bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {loading ? 'Submitting…' : 'Submit request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AccessPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<AccessRequestStatus | ''>('');
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<AccessRequestResponse | null>(null);

  const requests = useAccessRequests(statusFilter);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['access-requests'] });

  async function handleApprove(id: string) {
    const { error } = await api.POST('/v1/access-requests/{id}/approve', {
      params: { path: { id } },
      body: {},
    });
    if (error) { toast.error('Failed to approve request'); return; }
    toast.success('Request approved — time-boxed grant issued');
    invalidate();
  }

  async function handleReject(id: string) {
    const { error } = await api.POST('/v1/access-requests/{id}/reject', {
      params: { path: { id } },
      body: {},
    });
    if (error) { toast.error('Failed to reject request'); return; }
    toast.success('Request rejected');
    invalidate();
  }

  return (
    <>
      {showForm && (
        <SubmitModal onClose={() => setShowForm(false)} onSuccess={invalidate} />
      )}

      <div className="flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-fg">Access Requests</h1>
            <p className="mt-0.5 text-sm text-fg-muted">
              Request and manage temporary privileged access to systems and resources.
            </p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            Request access
          </button>
        </div>

        {/* Status filter */}
        <div className="flex gap-1 rounded-lg bg-surface-muted p-1 w-fit">
          {STATUS_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              className={[
                'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                statusFilter === value
                  ? 'bg-surface text-fg shadow-sm'
                  : 'text-fg-muted hover:text-fg-muted',
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
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Access type</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Target</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Duration</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Requested</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {requests.isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-fg-subtle">Loading…</td>
                </tr>
              )}
              {requests.isError && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-danger">
                    Failed to load requests. Is the API running?
                  </td>
                </tr>
              )}
              {requests.data?.data?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <ShieldCheck className="h-8 w-8 text-fg-subtle" strokeWidth={1.5} />
                      <span className="text-sm text-fg-subtle">No access requests found</span>
                      <span className="text-xs text-fg-subtle">Submit a request to get started</span>
                    </div>
                  </td>
                </tr>
              )}
              {requests.data?.data?.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer transition-colors hover:bg-surface-hover"
                  onClick={() => setSelected(r as AccessRequestResponse)}
                >
                  <td className="px-4 py-3 font-mono text-xs font-medium text-fg">{r.accessType}</td>
                  <td className="px-4 py-3 text-fg-muted">{r.target}</td>
                  <td className="px-4 py-3 text-fg-muted">{r.durationHours}h</td>
                  <td className="px-4 py-3">
                    <span
                      className={[
                        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
                        STATUS_CLASS[r.status] ?? 'bg-surface-muted text-fg-muted',
                      ].join(' ')}
                    >
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-fg-subtle">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    {r.status === 'pending' && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleApprove(r.id)}
                          className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-success transition-colors hover:bg-success-bg"
                        >
                          <CheckCircle className="h-3.5 w-3.5" strokeWidth={2} />
                          Approve
                        </button>
                        <button
                          onClick={() => handleReject(r.id)}
                          className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger-bg"
                        >
                          <XCircle className="h-3.5 w-3.5" strokeWidth={2} />
                          Reject
                        </button>
                      </div>
                    )}
                    {r.status === 'approved' && r.reviewedAt && (
                      <span className="text-xs text-fg-subtle">
                        Approved {new Date(r.reviewedAt).toLocaleDateString()}
                      </span>
                    )}
                    {r.status === 'rejected' && r.reviewNote && (
                      <span className="text-xs text-fg-subtle" title={r.reviewNote}>
                        Rejected — {r.reviewNote.slice(0, 30)}{r.reviewNote.length > 30 ? '…' : ''}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {requests.data?.pageInfo && (
            <div className="border-t border-border bg-surface-muted px-4 py-2.5 text-xs text-fg-subtle">
              {requests.data.pageInfo.total} request{requests.data.pageInfo.total !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      </div>

      {/* Access request detail slide-over */}
      <SlideOver
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.accessType ?? 'Access request'}
        description={selected ? `${selected.target} · ${selected.durationHours}h` : undefined}
        width="lg"
        headerActions={selected?.status === 'pending' ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => { handleApprove(selected.id); setSelected(null); }}
              className="flex items-center gap-1 rounded-md bg-success-bg px-3 py-1.5 text-xs font-medium text-success hover:bg-success-bg"
            >
              <CheckCircle className="h-3 w-3" strokeWidth={2} /> Approve
            </button>
            <button
              onClick={() => { handleReject(selected.id); setSelected(null); }}
              className="flex items-center gap-1 rounded-md bg-danger-bg px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger-bg"
            >
              <XCircle className="h-3 w-3" strokeWidth={2} /> Reject
            </button>
          </div>
        ) : undefined}
      >
        {selected && (
          <>
            <SlideOverSection title="Details">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {[
                  { label: 'Access type', value: selected.accessType },
                  { label: 'Target',      value: selected.target },
                  { label: 'Duration',    value: `${selected.durationHours}h` },
                  { label: 'Status',      value: <span className={['inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', STATUS_CLASS[selected.status] ?? 'bg-surface-muted text-fg-muted'].join(' ')}>{STATUS_LABEL[selected.status] ?? selected.status}</span> },
                  { label: 'Requested',   value: new Date(selected.createdAt).toLocaleDateString() },
                  { label: 'Reviewed',    value: selected.reviewedAt ? new Date(selected.reviewedAt).toLocaleDateString() : '—' },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <dt className="text-xs text-fg-subtle">{label}</dt>
                    <dd className="mt-0.5 text-fg">{value}</dd>
                  </div>
                ))}
              </dl>
              {selected.justification && (
                <div className="mt-4 rounded-md bg-surface-muted px-3 py-2.5 text-sm text-fg-muted">
                  <p className="mb-1 text-xs text-fg-subtle">Justification</p>
                  {selected.justification}
                </div>
              )}
              {selected.reviewNote && (
                <div className="mt-3 rounded-md bg-surface-muted px-3 py-2.5 text-sm text-fg-muted">
                  <p className="mb-1 text-xs text-fg-subtle">Review note</p>
                  {selected.reviewNote}
                </div>
              )}
            </SlideOverSection>

            <div className="mx-5 h-px bg-surface-muted" />

            <SlideOverSection title="Activity">
              <ActivityTimeline resourceId={selected.id} resourceType="access-request" />
            </SlideOverSection>
          </>
        )}
      </SlideOver>
    </>
  );
}
