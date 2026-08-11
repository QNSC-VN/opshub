import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Plus, CheckCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import {
  ActivityTimeline,
  Button,
  DataTable,
  DescriptionList,
  FormField,
  Input,
  ListPage,
  Modal,
  SegmentedControl,
  Select,
  SlideOver,
  SlideOverSection,
  StatusBadge,
  Textarea,
  humanizeStatus,
  statusTone,
  type DataTableColumn,
} from '@/shared/ui';
import { useListState } from '@/shared/hooks/use-list-state';
import { formatDate } from '@/shared/lib/format';
import type { AccessRequestResponse, AccessRequestStatus } from '@/shared/api/types';

const ACCESS_TYPE_OPTIONS = [
  { value: 'local_admin', label: 'Local Admin' },
  { value: 'pim_role', label: 'PIM Role (JIT elevation)' },
  { value: 'app_admin', label: 'App Admin' },
  { value: 'vpn', label: 'VPN' },
  { value: 'other', label: 'Other' },
] as const;
type AccessType = (typeof ACCESS_TYPE_OPTIONS)[number]['value'];

/*
 * NO LOCAL STATUS LABEL OR COLOUR MAPS.
 *
 * They used to live here — `pending` was amber, `expired` was a raw `bg-surface-muted` pair — and the
 * inbox, workforce and catalog screens each had their own copy that disagreed. `statusTone` owns which
 * tone a word MEANS and `StatusBadge` owns what a tone LOOKS like, so the same status is the same
 * colour everywhere and a new screen cannot invent a seventh.
 */

const STATUS_FILTERS = [
  { value: '' as const, label: 'All' },
  { value: 'pending' as const, label: 'Pending' },
  { value: 'approved' as const, label: 'Approved' },
  { value: 'rejected' as const, label: 'Rejected' },
];

// ── Hook ──────────────────────────────────────────────────────────────────────

function useAccessRequests(status: AccessRequestStatus | '', limit: number, offset: number) {
  return useQuery({
    // The offset is part of the key: without it React Query serves page 1 from cache for every page.
    queryKey: ['access-requests', 'list', status, limit, offset],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/access-requests', {
        params: { query: { status: (status || undefined) as never, limit, offset } },
      });
      if (error || !data) throw new Error('Failed to load access requests');
      return data;
    },
  });
}

// ── Submit modal ──────────────────────────────────────────────────────────────

interface SubmitModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * The request form.
 *
 * On `Modal`, which was already in the codebase and which this page — like nine others — had
 * reimplemented as a bare `fixed inset-0` overlay with NO `role="dialog"`, no focus trap, no Escape
 * and no scroll lock. Keyboard users could tab into the page behind it and screen readers were never
 * told a dialog had opened.
 */
function SubmitModal({ open, onClose, onSuccess }: SubmitModalProps) {
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
    if (error) {
      setErr('Failed to submit request. Please try again.');
      return;
    }
    toast.success('Access request submitted');
    onSuccess();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Request temporary access">
      <form id="access-request-form" onSubmit={onSubmit} className="flex flex-col gap-4 p-5">
        <FormField label="Access type" htmlFor="access-type" required>
          <Select
            id="access-type"
            required
            value={form.accessType}
            onChange={(e) => set('accessType', e.target.value as AccessType)}
          >
            {ACCESS_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label="Target system / resource" htmlFor="access-target" required>
          <Input
            id="access-target"
            required
            value={form.target}
            onChange={(e) => set('target', e.target.value)}
            placeholder="e.g. prod-db-01, 10.0.0.5, s3://my-bucket"
          />
        </FormField>

        <FormField label="Justification" htmlFor="access-justification" required>
          <Textarea
            id="access-justification"
            required
            value={form.justification}
            onChange={(e) => set('justification', e.target.value)}
            placeholder="Why do you need this access and for what purpose?"
          />
        </FormField>

        <FormField
          label="Duration (hours)"
          htmlFor="access-duration"
          hint="Maximum 720 hours (30 days). Access is automatically revoked after expiry."
        >
          <Input
            id="access-duration"
            type="number"
            min={1}
            max={720}
            required
            value={form.durationHours}
            onChange={(e) => set('durationHours', Number(e.target.value))}
          />
        </FormField>

        {err && <p className="text-xs text-danger">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={loading}>
            {loading ? 'Submitting…' : 'Submit request'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

/**
 * The table's columns.
 *
 * Declared outside the component so the array is not rebuilt every render, and taking the handlers as
 * an argument because the actions column needs them.
 */
function accessColumns(actions: {
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}): DataTableColumn<AccessRequestResponse>[] {
  return [
    {
      key: 'accessType',
      header: 'Access type',
      cell: (r) => <span className="font-mono text-xs font-medium text-fg">{r.accessType}</span>,
    },
    { key: 'target', header: 'Target', cell: (r) => r.target },
    { key: 'duration', header: 'Duration', cell: (r) => `${r.durationHours}h`, hideOnMobile: true },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <StatusBadge tone={statusTone(r.status)}>{humanizeStatus(r.status)}</StatusBadge>
      ),
    },
    {
      key: 'requested',
      header: 'Requested',
      cell: (r) => <span className="text-xs text-fg-subtle">{formatDate(r.createdAt)}</span>,
      hideOnMobile: true,
    },
    {
      key: 'actions',
      header: 'Actions',
      // `stopPropagation` because the row opens the detail panel: without it, approving also opens it.
      cell: (r) => (
        <div onClick={(e) => e.stopPropagation()}>
          {r.status === 'pending' && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => actions.onApprove(r.id)}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-success transition-colors hover:bg-success-bg"
              >
                <CheckCircle className="h-3.5 w-3.5" strokeWidth={2} />
                Approve
              </button>
              <button
                onClick={() => actions.onReject(r.id)}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger-bg"
              >
                <XCircle className="h-3.5 w-3.5" strokeWidth={2} />
                Reject
              </button>
            </div>
          )}
          {r.status === 'approved' && r.reviewedAt && (
            <span className="text-xs text-fg-subtle">Approved {formatDate(r.reviewedAt)}</span>
          )}
          {r.status === 'rejected' && r.reviewNote && (
            <span className="text-xs text-fg-subtle" title={r.reviewNote}>
              Rejected — {r.reviewNote.slice(0, 30)}
              {r.reviewNote.length > 30 ? '…' : ''}
            </span>
          )}
        </div>
      ),
    },
  ];
}

export function AccessPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<AccessRequestStatus | ''>('');
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<AccessRequestResponse | null>(null);
  const list = useListState();

  const requests = useAccessRequests(statusFilter, list.limit, list.offset);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['access-requests'] });

  async function handleApprove(id: string) {
    const { error } = await api.POST('/v1/access-requests/{id}/approve', {
      params: { path: { id } },
      body: {},
    });
    if (error) {
      toast.error(apiErrorMessage(error, 'Failed to approve request.'));
      return;
    }
    toast.success('Request approved — time-boxed grant issued');
    invalidate();
  }

  async function handleReject(id: string) {
    const { error } = await api.POST('/v1/access-requests/{id}/reject', {
      params: { path: { id } },
      body: {},
    });
    if (error) {
      toast.error(apiErrorMessage(error, 'Failed to reject request.'));
      return;
    }
    toast.success('Request rejected');
    invalidate();
  }

  return (
    <>
      <SubmitModal open={showForm} onClose={() => setShowForm(false)} onSuccess={invalidate} />

      <ListPage
        title="Access Requests"
        description="Request and manage temporary privileged access to systems and resources."
        actions={
          <Button variant="primary" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" strokeWidth={2} />
            Request access
          </Button>
        }
        filters={
          <SegmentedControl
            label="Filter by status"
            options={STATUS_FILTERS}
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(value);
              // Narrowing the set invalidates the offset — page 3 of the pending ones may not exist.
              list.resetPaging();
            }}
          />
        }
        pageInfo={requests.data?.pageInfo}
        onOffsetChange={list.goToOffset}
        noun="requests"
      >
        <DataTable
          columns={accessColumns({ onApprove: handleApprove, onReject: handleReject })}
          rows={requests.data?.data as AccessRequestResponse[] | undefined}
          isLoading={requests.isLoading}
          isError={requests.isError}
          errorMessage="Failed to load requests. Is the API running?"
          emptyMessage="No access requests found"
          emptyIcon={ShieldCheck}
          onRowClick={setSelected}
          isRowActive={(r) => r.id === selected?.id}
        />
      </ListPage>

      <SlideOver
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.accessType ?? 'Access request'}
        description={selected ? `${selected.target} · ${selected.durationHours}h` : undefined}
        width="lg"
        headerActions={
          selected?.status === 'pending' ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  handleApprove(selected.id);
                  setSelected(null);
                }}
                className="flex items-center gap-1 rounded-md bg-success-bg px-3 py-1.5 text-xs font-medium text-success"
              >
                <CheckCircle className="h-3 w-3" strokeWidth={2} /> Approve
              </button>
              <button
                onClick={() => {
                  handleReject(selected.id);
                  setSelected(null);
                }}
                className="flex items-center gap-1 rounded-md bg-danger-bg px-3 py-1.5 text-xs font-medium text-danger"
              >
                <XCircle className="h-3 w-3" strokeWidth={2} /> Reject
              </button>
            </div>
          ) : undefined
        }
      >
        {selected && (
          <>
            <SlideOverSection title="Details">
              <DescriptionList
                items={[
                  { label: 'Access type', value: selected.accessType },
                  { label: 'Target', value: selected.target },
                  { label: 'Duration', value: `${selected.durationHours}h` },
                  {
                    label: 'Status',
                    value: (
                      <StatusBadge tone={statusTone(selected.status)}>
                        {humanizeStatus(selected.status)}
                      </StatusBadge>
                    ),
                  },
                  { label: 'Requested', value: formatDate(selected.createdAt) },
                  // No `?? '—'`: DescriptionList renders the em dash for an absent value, which is
                  // what makes it consistent across every panel rather than per call site.
                  { label: 'Reviewed', value: formatDate(selected.reviewedAt) },
                  { label: 'Justification', value: selected.justification, wide: true },
                  { label: 'Review note', value: selected.reviewNote, wide: true },
                ]}
              />
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
