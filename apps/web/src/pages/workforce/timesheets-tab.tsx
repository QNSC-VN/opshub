import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Clock } from 'lucide-react';
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
  SegmentedControl,
  StatusBadge,
  Textarea,
  humanizeStatus,
  statusTone,
  type DataTableColumn,
} from '@/shared/ui';
import { useListState } from '@/shared/hooks/use-list-state';
import { formatDate } from '@/shared/lib/format';
import type { TimesheetResponse, TimesheetStatus } from '@/shared/api/types';
import {
  FormActions,
  PanelAction,
  RowAction,
  RowActions,
  TabToolbar,
  type FormModalProps,
} from './workforce-shared';
import { asHoursAndMinutes } from './duration';

const TS_FILTERS: { value: TimesheetStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

function LogTimesheetModal({ open, onClose, onSuccess }: FormModalProps) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ workDate: '', minutesWorked: 480, note: '' });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await api.POST('/v1/workforce/timesheets', {
      body: {
        workDate: form.workDate,
        minutesWorked: form.minutesWorked,
        note: form.note || undefined,
      },
    });
    setLoading(false);
    if (error) {
      toast.error('Failed to log timesheet');
      return;
    }
    toast.success('Timesheet logged');
    onSuccess();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Log timesheet" size="sm">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
        <FormField label="Work date" htmlFor="ts-date" required>
          <Input
            id="ts-date"
            type="date"
            required
            value={form.workDate}
            onChange={(e) => setForm((f) => ({ ...f, workDate: e.target.value }))}
          />
        </FormField>
        <FormField
          label="Minutes worked"
          htmlFor="ts-minutes"
          required
          hint={asHoursAndMinutes(form.minutesWorked)}
        >
          <Input
            id="ts-minutes"
            type="number"
            required
            min={1}
            max={1440}
            value={form.minutesWorked}
            onChange={(e) => setForm((f) => ({ ...f, minutesWorked: Number(e.target.value) }))}
          />
        </FormField>
        <FormField label="Note" htmlFor="ts-note">
          <Textarea
            id="ts-note"
            rows={2}
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="Optional notes…"
          />
        </FormField>
        <FormActions loading={loading} onClose={onClose} submitLabel="Log" />
      </form>
    </Modal>
  );
}

export function TimesheetsTab() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<TimesheetStatus | ''>('');
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<TimesheetResponse | null>(null);
  const list = useListState();

  const { data, isLoading, isError } = useQuery({
    // The offset belongs in the key: without it React Query serves page 1 for every page.
    queryKey: ['workforce', 'timesheets', statusFilter, list.offset, list.limit],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/workforce/timesheets', {
        params: {
          query: {
            status: (statusFilter || undefined) as never,
            limit: list.limit,
            offset: list.offset,
          },
        },
      });
      if (error || !data) throw new Error('Failed to load timesheets');
      return data;
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['workforce', 'timesheets'] });

  async function handleSubmitTs(id: string) {
    const { error } = await api.POST('/v1/workforce/timesheets/{id}/submit', {
      params: { path: { id } },
    });
    if (error) {
      toast.error('Failed to submit timesheet');
      return;
    }
    toast.success('Timesheet submitted for review');
    invalidate();
  }

  async function handleReviewTs(id: string, approve: boolean) {
    const { error } = await api.POST('/v1/workforce/timesheets/{id}/review', {
      params: { path: { id } },
      body: { approve },
    });
    if (error) {
      toast.error(`Failed to ${approve ? 'approve' : 'reject'} timesheet`);
      return;
    }
    toast.success(`Timesheet ${approve ? 'approved' : 'rejected'}`);
    invalidate();
  }

  const columns: DataTableColumn<TimesheetResponse>[] = [
    { key: 'workDate', header: 'Work date', cell: (t) => formatDate(t.workDate) },
    {
      key: 'minutes',
      header: 'Minutes',
      cell: (t) => `${t.minutesWorked} min (${asHoursAndMinutes(t.minutesWorked)})`,
    },
    {
      key: 'note',
      header: 'Note',
      cell: (t) => <span className="text-xs text-fg-subtle">{t.note ?? '—'}</span>,
      className: 'max-w-xs truncate',
      hideOnMobile: true,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (t) => (
        <StatusBadge tone={statusTone(t.status)}>{humanizeStatus(t.status)}</StatusBadge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      cell: (t) => (
        <RowActions>
          {t.status === 'draft' && (
            <RowAction tone="accent" onClick={() => handleSubmitTs(t.id)}>
              Submit
            </RowAction>
          )}
          {t.status === 'submitted' && (
            <>
              <RowAction tone="success" onClick={() => handleReviewTs(t.id, true)}>
                Approve
              </RowAction>
              <RowAction tone="danger" onClick={() => handleReviewTs(t.id, false)}>
                Reject
              </RowAction>
            </>
          )}
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <LogTimesheetModal
        open={showForm}
        onClose={() => setShowForm(false)}
        onSuccess={invalidate}
      />

      <div className="flex flex-col gap-4">
        <TabToolbar
          filter={
            <SegmentedControl
              label="Filter timesheets by status"
              options={TS_FILTERS}
              value={statusFilter}
              onChange={(value) => {
                setStatusFilter(value);
                list.resetPaging();
              }}
            />
          }
          action={
            <Button variant="primary" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4" strokeWidth={2} /> Log timesheet
            </Button>
          }
        />

        <DataTable
          columns={columns}
          rows={data?.data as TimesheetResponse[] | undefined}
          isLoading={isLoading}
          isError={isError}
          errorMessage="Failed to load timesheets."
          emptyMessage="No timesheets found"
          emptyIcon={Clock}
          onRowClick={setSelected}
          isRowActive={(t) => t.id === selected?.id}
        />

        <PaginationFooter
          pageInfo={data?.pageInfo}
          onOffsetChange={list.goToOffset}
          noun="timesheets"
        />
      </div>

      <EntityDetailPanel
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? formatDate(selected.workDate) : 'Timesheet'}
        description={
          selected
            ? `${selected.minutesWorked} min · ${humanizeStatus(selected.status)}`
            : undefined
        }
        headerActions={
          selected && (selected.status === 'draft' || selected.status === 'submitted') ? (
            <div className="flex items-center gap-2">
              {selected.status === 'draft' && (
                <PanelAction
                  tone="accent"
                  onClick={() => {
                    handleSubmitTs(selected.id);
                    setSelected(null);
                  }}
                >
                  Submit
                </PanelAction>
              )}
              {selected.status === 'submitted' && (
                <>
                  <PanelAction
                    tone="success"
                    onClick={() => {
                      handleReviewTs(selected.id, true);
                      setSelected(null);
                    }}
                  >
                    Approve
                  </PanelAction>
                  <PanelAction
                    tone="danger"
                    onClick={() => {
                      handleReviewTs(selected.id, false);
                      setSelected(null);
                    }}
                  >
                    Reject
                  </PanelAction>
                </>
              )}
            </div>
          ) : undefined
        }
        items={
          selected
            ? [
                { label: 'Work date', value: formatDate(selected.workDate) },
                {
                  label: 'Minutes',
                  value: `${selected.minutesWorked} min (${asHoursAndMinutes(selected.minutesWorked)})`,
                },
                {
                  label: 'Status',
                  value: (
                    <StatusBadge tone={statusTone(selected.status)}>
                      {humanizeStatus(selected.status)}
                    </StatusBadge>
                  ),
                },
                { label: 'Note', value: selected.note, wide: true },
              ]
            : []
        }
        activity={selected ? { resourceId: selected.id, resourceType: 'timesheet' } : undefined}
      />
    </>
  );
}
