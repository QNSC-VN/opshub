import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import {
  Button,
  DataTable,
  EntityDetailPanel,
  FormField,
  Input,
  Modal,
  PaginationFooter,
  PhotoUploadWidget,
  SegmentedControl,
  Select,
  SlideOverSection,
  StatusBadge,
  Textarea,
  humanizeStatus,
  statusTone,
  type DataTableColumn,
} from '@/shared/ui';
import { useListState } from '@/shared/hooks/use-list-state';
import { formatDate } from '@/shared/lib/format';
import type { LeaveResponse, LeaveStatus, LeaveType } from '@/shared/api/types';
import {
  FormActions,
  PanelAction,
  RowAction,
  RowActions,
  TabToolbar,
  type FormModalProps,
} from './workforce-shared';

const LEAVE_FILTERS: { value: LeaveStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

const LEAVE_TYPES: LeaveType[] = ['annual', 'sick', 'unpaid', 'parental', 'other'];

function RequestLeaveModal({ open, onClose, onSuccess }: FormModalProps) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    leaveType: 'annual' as LeaveType,
    startDate: '',
    endDate: '',
    reason: '',
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await api.POST('/v1/workforce/leave', {
      body: {
        leaveType: form.leaveType as 'annual' | 'sick' | 'unpaid' | 'parental' | 'other',
        startDate: form.startDate,
        endDate: form.endDate,
        reason: form.reason || undefined,
      },
    });
    setLoading(false);
    if (error) {
      toast.error('Failed to submit leave request');
      return;
    }
    toast.success('Leave request submitted');
    onSuccess();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Request leave" size="sm">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
        <FormField label="Leave type" htmlFor="leave-type" required>
          <Select
            id="leave-type"
            value={form.leaveType}
            onChange={(e) => setForm((f) => ({ ...f, leaveType: e.target.value as LeaveType }))}
          >
            {LEAVE_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanizeStatus(t)}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Start date" htmlFor="leave-start" required>
            <Input
              id="leave-start"
              type="date"
              required
              value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
            />
          </FormField>
          <FormField label="End date" htmlFor="leave-end" required>
            <Input
              id="leave-end"
              type="date"
              required
              value={form.endDate}
              onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
            />
          </FormField>
        </div>
        <FormField label="Reason" htmlFor="leave-reason">
          <Textarea
            id="leave-reason"
            rows={2}
            value={form.reason}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            placeholder="Optional reason…"
          />
        </FormField>
        <FormActions loading={loading} onClose={onClose} submitLabel="Request" />
      </form>
    </Modal>
  );
}

export function LeaveTab() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | ''>('');
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<LeaveResponse | null>(null);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const list = useListState();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['workforce', 'leave', statusFilter, list.offset, list.limit],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/workforce/leave', {
        params: {
          query: {
            status: (statusFilter || undefined) as never,
            limit: list.limit,
            offset: list.offset,
          },
        },
      });
      if (error || !data) throw new Error('Failed to load leave');
      return data;
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['workforce', 'leave'] });

  async function handleReview(id: string, approve: boolean) {
    const { error } = await api.POST('/v1/workforce/leave/{id}/review', {
      params: { path: { id } },
      body: { approve },
    });
    if (error) {
      toast.error(`Failed to ${approve ? 'approve' : 'reject'} leave`);
      return;
    }
    toast.success(`Leave ${approve ? 'approved' : 'rejected'}`);
    invalidate();
  }

  async function handleCancel(id: string) {
    const { error } = await api.POST('/v1/workforce/leave/{id}/cancel', {
      params: { path: { id } },
    });
    if (error) {
      toast.error('Failed to cancel leave request');
      return;
    }
    toast.success('Leave request cancelled');
    invalidate();
  }

  const columns: DataTableColumn<LeaveResponse>[] = [
    { key: 'type', header: 'Type', cell: (l) => humanizeStatus(l.leaveType) },
    { key: 'start', header: 'Start', cell: (l) => formatDate(l.startDate) },
    { key: 'end', header: 'End', cell: (l) => formatDate(l.endDate), hideOnMobile: true },
    {
      key: 'days',
      header: 'Days',
      // The cost the API froze at submit — half days included, which is why it is `numeric(5,2)`.
      cell: (l) => (l.workingDays === null ? '—' : l.workingDays),
      align: 'right',
    },
    {
      key: 'reason',
      header: 'Reason',
      cell: (l) => <span className="text-xs text-fg-subtle">{l.reason ?? '—'}</span>,
      className: 'max-w-xs truncate',
      hideOnMobile: true,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (l) => (
        <StatusBadge tone={statusTone(l.status)}>{humanizeStatus(l.status)}</StatusBadge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      cell: (l) => (
        <RowActions>
          {l.status === 'pending' && (
            <>
              <RowAction tone="success" onClick={() => handleReview(l.id, true)}>
                Approve
              </RowAction>
              <RowAction tone="danger" onClick={() => handleReview(l.id, false)}>
                Reject
              </RowAction>
              <RowAction tone="muted" onClick={() => handleCancel(l.id)}>
                Cancel
              </RowAction>
            </>
          )}
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <RequestLeaveModal
        open={showForm}
        onClose={() => setShowForm(false)}
        onSuccess={invalidate}
      />

      <div className="flex flex-col gap-4">
        <TabToolbar
          filter={
            <SegmentedControl
              label="Filter leave by status"
              options={LEAVE_FILTERS}
              value={statusFilter}
              onChange={(value) => {
                setStatusFilter(value);
                list.resetPaging();
              }}
            />
          }
          action={
            <Button variant="primary" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4" strokeWidth={2} /> Request leave
            </Button>
          }
        />

        <DataTable
          columns={columns}
          rows={data?.data as LeaveResponse[] | undefined}
          isLoading={isLoading}
          isError={isError}
          errorMessage="Failed to load leave records."
          emptyMessage="No leave records found"
          emptyIcon={Calendar}
          onRowClick={(l) => {
            setSelected(l);
            setDocumentUrl(null);
          }}
          isRowActive={(l) => l.id === selected?.id}
        />

        <PaginationFooter
          pageInfo={data?.pageInfo}
          onOffsetChange={list.goToOffset}
          noun="leave records"
        />
      </div>

      <EntityDetailPanel
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${humanizeStatus(selected.leaveType)} leave` : 'Leave request'}
        description={
          selected
            ? `${formatDate(selected.startDate)} – ${formatDate(selected.endDate)} · ${humanizeStatus(selected.status)}`
            : undefined
        }
        headerActions={
          selected?.status === 'pending' ? (
            <div className="flex items-center gap-2">
              <PanelAction
                tone="success"
                onClick={() => {
                  handleReview(selected.id, true);
                  setSelected(null);
                }}
              >
                Approve
              </PanelAction>
              <PanelAction
                tone="danger"
                onClick={() => {
                  handleReview(selected.id, false);
                  setSelected(null);
                }}
              >
                Reject
              </PanelAction>
              <PanelAction
                tone="muted"
                onClick={() => {
                  handleCancel(selected.id);
                  setSelected(null);
                }}
              >
                Cancel
              </PanelAction>
            </div>
          ) : undefined
        }
        items={
          selected
            ? [
                { label: 'Type', value: humanizeStatus(selected.leaveType) },
                {
                  label: 'Status',
                  value: (
                    <StatusBadge tone={statusTone(selected.status)}>
                      {humanizeStatus(selected.status)}
                    </StatusBadge>
                  ),
                },
                { label: 'Start', value: formatDate(selected.startDate) },
                { label: 'End', value: formatDate(selected.endDate) },
                { label: 'Working days', value: selected.workingDays },
                { label: 'Reason', value: selected.reason, wide: true },
              ]
            : []
        }
        activity={selected ? { resourceId: selected.id, resourceType: 'leave' } : undefined}
      >
        {selected && (
          <SlideOverSection title="Supporting document">
            <PhotoUploadWidget
              mode="document"
              currentUrl={documentUrl}
              presignUrl={`/v1/workforce/leave-requests/${selected.id}/document/presign`}
              confirmUrl={`/v1/workforce/leave-requests/${selected.id}/document/confirm`}
              accept="application/pdf,image/jpeg,image/png"
              onSuccess={(url) => setDocumentUrl(url)}
              label="Attach a medical certificate or supporting document (PDF, JPEG, PNG · max 10 MB)"
            />
          </SlideOverSection>
        )}
      </EntityDetailPanel>
    </>
  );
}
