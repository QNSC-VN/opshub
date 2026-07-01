import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Clock, Calendar, Zap, Moon } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { SlideOver, SlideOverSection } from '@/shared/ui/slide-over';
import { ActivityTimeline } from '@/shared/ui/activity-timeline';
import { PhotoUploadWidget } from '@/shared/ui/photo-upload';
import type {
  TimesheetResponse,
  LeaveResponse,
  OvertimeResponse,
  ShiftLogResponse,
  TimesheetStatus,
  LeaveType,
  LeaveStatus,
  OvertimeStatus,
  ShiftType,
} from '@/shared/api/types';

// ── Shared ────────────────────────────────────────────────────────────────────

const inputClass =
  'h-8 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

const TIMESHEET_STATUS_CLASS: Record<TimesheetStatus, string> = {
  draft: 'bg-surface-muted text-fg-muted',
  submitted: 'bg-warning-bg text-warning',
  approved: 'bg-success-bg text-success',
  rejected: 'bg-danger-bg text-danger',
};

const LEAVE_STATUS_CLASS: Record<LeaveStatus, string> = {
  pending: 'bg-warning-bg text-warning',
  approved: 'bg-success-bg text-success',
  rejected: 'bg-danger-bg text-danger',
  cancelled: 'bg-surface-muted text-fg-muted',
};

const OVERTIME_STATUS_CLASS: Record<OvertimeStatus, string> = {
  pending: 'bg-warning-bg text-warning',
  approved: 'bg-success-bg text-success',
  rejected: 'bg-danger-bg text-danger',
};

const SHIFT_TYPE_LABEL: Record<ShiftType, string> = {
  night: 'Night',
  on_call: 'On-call',
  weekend: 'Weekend',
};

function StatusBadge({ className, label }: { className: string; label: string }) {
  return (
    <span className={['inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', className].join(' ')}>
      {label}
    </span>
  );
}

// ── Timesheets tab ────────────────────────────────────────────────────────────

const TS_FILTERS: { value: TimesheetStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

interface LogTimesheetModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function LogTimesheetModal({ onClose, onSuccess }: LogTimesheetModalProps) {
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
    if (error) { toast.error('Failed to log timesheet'); return; }
    toast.success('Timesheet logged');
    onSuccess();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-sm rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-fg">Log timesheet</h2>
          <button onClick={onClose} className="rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg-muted"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Work date *</label>
            <input type="date" required value={form.workDate} onChange={(e) => setForm(f => ({ ...f, workDate: e.target.value }))} className={inputClass} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Minutes worked *</label>
            <input type="number" required min={1} max={1440} value={form.minutesWorked}
              onChange={(e) => setForm(f => ({ ...f, minutesWorked: Number(e.target.value) }))} className={inputClass} />
            <p className="text-xs text-fg-subtle">{Math.floor(form.minutesWorked / 60)}h {form.minutesWorked % 60}m</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Note</label>
            <textarea value={form.note} onChange={(e) => setForm(f => ({ ...f, note: e.target.value }))}
              rows={2} placeholder="Optional notes…"
              className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="h-8 rounded-md border border-border px-3.5 text-sm font-medium text-fg-muted hover:bg-surface-hover">Cancel</button>
            <button type="submit" disabled={loading} className="h-8 rounded-md bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60">{loading ? 'Saving…' : 'Log'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TimesheetsTab() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<TimesheetStatus | ''>('');
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<TimesheetResponse | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['workforce', 'timesheets', statusFilter],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/workforce/timesheets', {
        params: { query: { status: (statusFilter || undefined) as never, limit: 50 } },
      });
      if (error || !data) throw new Error('Failed to load timesheets');
      return data;
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['workforce', 'timesheets'] });

  async function handleSubmitTs(id: string) {
    const { error } = await api.POST('/v1/workforce/timesheets/{id}/submit', { params: { path: { id } } });
    if (error) { toast.error('Failed to submit timesheet'); return; }
    toast.success('Timesheet submitted for review');
    invalidate();
  }

  async function handleReviewTs(id: string, approve: boolean) {
    const { error } = await api.POST('/v1/workforce/timesheets/{id}/review', {
      params: { path: { id } }, body: { approve },
    });
    if (error) { toast.error(`Failed to ${approve ? 'approve' : 'reject'} timesheet`); return; }
    toast.success(`Timesheet ${approve ? 'approved' : 'rejected'}`);
    invalidate();
  }

  return (
    <>
      {showForm && <LogTimesheetModal onClose={() => setShowForm(false)} onSuccess={invalidate} />}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1 rounded-lg bg-surface-muted p-1 w-fit">
            {TS_FILTERS.map(({ value, label }) => (
              <button key={value} onClick={() => setStatusFilter(value)}
                className={['rounded-md px-3 py-1 text-sm font-medium transition-colors',
                  statusFilter === value ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg-muted'].join(' ')}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover">
            <Plus className="h-4 w-4" strokeWidth={2} /> Log timesheet
          </button>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted">
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Work date</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Minutes</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Note</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-fg-subtle">Loading…</td></tr>}
              {isError && <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-danger">Failed to load timesheets.</td></tr>}
              {data?.data?.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-fg-subtle">No timesheets found</td></tr>}
              {data?.data?.map((t) => (
                <tr
                  key={t.id}
                  className="cursor-pointer hover:bg-surface-hover"
                  onClick={() => setSelected(t as TimesheetResponse)}
                >
                  <td className="px-4 py-3 text-fg">{new Date(t.workDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-fg-muted">{t.minutesWorked} min ({Math.floor(t.minutesWorked / 60)}h {t.minutesWorked % 60}m)</td>
                  <td className="px-4 py-3 max-w-xs truncate text-xs text-fg-subtle">{t.note ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge className={TIMESHEET_STATUS_CLASS[t.status]} label={t.status.charAt(0).toUpperCase() + t.status.slice(1)} />
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      {t.status === 'draft' && (
                        <button onClick={() => handleSubmitTs(t.id)} className="rounded px-2 py-1 text-xs font-medium text-accent hover:bg-accent-muted">Submit</button>
                      )}
                      {t.status === 'submitted' && (<>
                        <button onClick={() => handleReviewTs(t.id, true)} className="rounded px-2 py-1 text-xs font-medium text-success hover:bg-success-bg">Approve</button>
                        <button onClick={() => handleReviewTs(t.id, false)} className="rounded px-2 py-1 text-xs font-medium text-danger hover:bg-danger-bg">Reject</button>
                      </>)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data?.pageInfo && <div className="border-t border-border bg-surface-muted px-4 py-2.5 text-xs text-fg-subtle">{data.pageInfo.total} record{data.pageInfo.total !== 1 ? 's' : ''}</div>}
        </div>
      </div>

      <SlideOver
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? new Date(selected.workDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Timesheet'}
        description={selected ? `${selected.minutesWorked} min · ${selected.status}` : undefined}
        width="md"
        headerActions={selected && (selected.status === 'draft' || selected.status === 'submitted') ? (
          <div className="flex items-center gap-2">
            {selected.status === 'draft' && (
              <button onClick={() => { handleSubmitTs(selected.id); setSelected(null); }}
                className="rounded-md bg-accent-muted px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-muted">
                Submit
              </button>
            )}
            {selected.status === 'submitted' && (<>
              <button onClick={() => { handleReviewTs(selected.id, true); setSelected(null); }}
                className="rounded-md bg-success-bg px-3 py-1.5 text-xs font-medium text-success hover:bg-success-bg">
                Approve
              </button>
              <button onClick={() => { handleReviewTs(selected.id, false); setSelected(null); }}
                className="rounded-md bg-danger-bg px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger-bg">
                Reject
              </button>
            </>)}
          </div>
        ) : undefined}
      >
        {selected && (
          <>
            <SlideOverSection title="Details">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {[
                  { label: 'Work date',   value: new Date(selected.workDate).toLocaleDateString() },
                  { label: 'Minutes',     value: `${selected.minutesWorked} min (${Math.floor(selected.minutesWorked / 60)}h ${selected.minutesWorked % 60}m)` },
                  { label: 'Status',      value: <StatusBadge className={TIMESHEET_STATUS_CLASS[selected.status]} label={selected.status.charAt(0).toUpperCase() + selected.status.slice(1)} /> },
                ].map(({ label, value }) => (
                  <div key={label}><dt className="text-xs text-fg-subtle">{label}</dt><dd className="mt-0.5 text-fg">{value}</dd></div>
                ))}
              </dl>
              {selected.note && (
                <div className="mt-4 rounded-md bg-surface-muted px-3 py-2.5 text-sm text-fg-muted">
                  <p className="mb-1 text-xs text-fg-subtle">Note</p>
                  {selected.note}
                </div>
              )}
            </SlideOverSection>
            <div className="mx-5 h-px bg-surface-muted" />
            <SlideOverSection title="Activity">
              <ActivityTimeline resourceId={selected.id} resourceType="timesheet" />
            </SlideOverSection>
          </>
        )}
      </SlideOver>
    </>
  );
}

// ── Leave tab ─────────────────────────────────────────────────────────────────

interface RequestLeaveModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function RequestLeaveModal({ onClose, onSuccess }: RequestLeaveModalProps) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ leaveType: 'annual' as LeaveType, startDate: '', endDate: '', reason: '' });

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
    if (error) { toast.error('Failed to submit leave request'); return; }
    toast.success('Leave request submitted');
    onSuccess();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-sm rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-fg">Request leave</h2>
          <button onClick={onClose} className="rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg-muted"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Leave type *</label>
            <select value={form.leaveType} onChange={(e) => setForm(f => ({ ...f, leaveType: e.target.value as LeaveType }))}
              className={inputClass}>
              <option value="annual">Annual</option>
              <option value="sick">Sick</option>
              <option value="unpaid">Unpaid</option>
              <option value="parental">Parental</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-fg-muted">Start date *</label>
              <input type="date" required value={form.startDate} onChange={(e) => setForm(f => ({ ...f, startDate: e.target.value }))} className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-fg-muted">End date *</label>
              <input type="date" required value={form.endDate} onChange={(e) => setForm(f => ({ ...f, endDate: e.target.value }))} className={inputClass} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Reason</label>
            <textarea value={form.reason} onChange={(e) => setForm(f => ({ ...f, reason: e.target.value }))}
              rows={2} placeholder="Optional reason…"
              className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="h-8 rounded-md border border-border px-3.5 text-sm font-medium text-fg-muted hover:bg-surface-hover">Cancel</button>
            <button type="submit" disabled={loading} className="h-8 rounded-md bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60">{loading ? 'Submitting…' : 'Request'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LeaveTab() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | ''>('');
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<LeaveResponse | null>(null);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);

  const LEAVE_FILTERS: { value: LeaveStatus | ''; label: string }[] = [
    { value: '', label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  const { data, isLoading, isError } = useQuery({
    queryKey: ['workforce', 'leave', statusFilter],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/workforce/leave', {
        params: { query: { status: (statusFilter || undefined) as never, limit: 50 } },
      });
      if (error || !data) throw new Error('Failed to load leave');
      return data;
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['workforce', 'leave'] });

  async function handleReview(id: string, approve: boolean) {
    const { error } = await api.POST('/v1/workforce/leave/{id}/review', {
      params: { path: { id } }, body: { approve },
    });
    if (error) { toast.error(`Failed to ${approve ? 'approve' : 'reject'} leave`); return; }
    toast.success(`Leave ${approve ? 'approved' : 'rejected'}`);
    invalidate();
  }

  async function handleCancel(id: string) {
    const { error } = await api.POST('/v1/workforce/leave/{id}/cancel', {
      params: { path: { id } },
    });
    if (error) { toast.error('Failed to cancel leave request'); return; }
    toast.success('Leave request cancelled');
    invalidate();
  }

  return (
    <>
      {showForm && <RequestLeaveModal onClose={() => setShowForm(false)} onSuccess={invalidate} />}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1 rounded-lg bg-surface-muted p-1 w-fit">
            {LEAVE_FILTERS.map(({ value, label }) => (
              <button key={value} onClick={() => setStatusFilter(value)}
                className={['rounded-md px-3 py-1 text-sm font-medium transition-colors',
                  statusFilter === value ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg-muted'].join(' ')}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover">
            <Plus className="h-4 w-4" strokeWidth={2} /> Request leave
          </button>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted">
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Type</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Start</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">End</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Reason</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-fg-subtle">Loading…</td></tr>}
              {isError && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-danger">Failed to load leave records.</td></tr>}
              {data?.data?.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-fg-subtle">No leave records found</td></tr>}
              {data?.data?.map((l) => (
                <tr
                  key={l.id}
                  className="cursor-pointer hover:bg-surface-hover"
                  onClick={() => { setSelected(l as LeaveResponse); setDocumentUrl(null); }}
                >
                  <td className="px-4 py-3 capitalize text-fg">{l.leaveType.replace('_', ' ')}</td>
                  <td className="px-4 py-3 text-fg-muted">{new Date(l.startDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-fg-muted">{new Date(l.endDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3 max-w-xs truncate text-xs text-fg-subtle">{l.reason ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge className={LEAVE_STATUS_CLASS[l.status]}
                      label={l.status.charAt(0).toUpperCase() + l.status.slice(1)} />
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      {l.status === 'pending' && (<>
                        <button onClick={() => handleReview(l.id, true)} className="rounded px-2 py-1 text-xs font-medium text-success hover:bg-success-bg">Approve</button>
                        <button onClick={() => handleReview(l.id, false)} className="rounded px-2 py-1 text-xs font-medium text-danger hover:bg-danger-bg">Reject</button>
                        <button onClick={() => handleCancel(l.id)} className="rounded px-2 py-1 text-xs font-medium text-fg-muted hover:bg-surface-hover">Cancel</button>
                      </>)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data?.pageInfo && <div className="border-t border-border bg-surface-muted px-4 py-2.5 text-xs text-fg-subtle">{data.pageInfo.total} record{data.pageInfo.total !== 1 ? 's' : ''}</div>}
        </div>
      </div>
      <SlideOver
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.leaveType.replace('_', ' ')} leave` : 'Leave request'}
        description={selected ? `${new Date(selected.startDate).toLocaleDateString()} – ${new Date(selected.endDate).toLocaleDateString()} · ${selected.status}` : undefined}
        width="md"
        headerActions={selected?.status === 'pending' ? (
          <div className="flex items-center gap-2">
            <button onClick={() => { handleReview(selected.id, true); setSelected(null); }}
              className="rounded-md bg-success-bg px-3 py-1.5 text-xs font-medium text-success hover:bg-success-bg">Approve</button>
            <button onClick={() => { handleReview(selected.id, false); setSelected(null); }}
              className="rounded-md bg-danger-bg px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger-bg">Reject</button>
            <button onClick={() => { handleCancel(selected.id); setSelected(null); }}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-fg-muted hover:bg-surface-hover">Cancel</button>
          </div>
        ) : undefined}
      >
        {selected && (
          <>
            <SlideOverSection title="Details">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {[
                  { label: 'Type',    value: <span className="capitalize">{selected.leaveType.replace('_', ' ')}</span> },
                  { label: 'Status',  value: <StatusBadge className={LEAVE_STATUS_CLASS[selected.status]} label={selected.status.charAt(0).toUpperCase() + selected.status.slice(1)} /> },
                  { label: 'Start',   value: new Date(selected.startDate).toLocaleDateString() },
                  { label: 'End',     value: new Date(selected.endDate).toLocaleDateString() },
                ].map(({ label, value }) => (
                  <div key={label}><dt className="text-xs text-fg-subtle">{label}</dt><dd className="mt-0.5 text-fg">{value}</dd></div>
                ))}
              </dl>
              {selected.reason && (
                <div className="mt-4 rounded-md bg-surface-muted px-3 py-2.5 text-sm text-fg-muted">
                  <p className="mb-1 text-xs text-fg-subtle">Reason</p>
                  {selected.reason}
                </div>
              )}
            </SlideOverSection>
            <div className="mx-5 h-px bg-surface-muted" />
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
            <div className="mx-5 h-px bg-surface-muted" />
            <SlideOverSection title="Activity">
              <ActivityTimeline resourceId={selected.id} resourceType="leave" />
            </SlideOverSection>
          </>
        )}
      </SlideOver>    </>
  );
}

// ── Overtime tab ──────────────────────────────────────────────────────────────

interface LogOvertimeModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function LogOvertimeModal({ onClose, onSuccess }: LogOvertimeModalProps) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ workDate: '', hours: 2, reason: '' });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await api.POST('/v1/workforce/overtime', {
      body: { workDate: form.workDate, hours: form.hours, reason: form.reason },
    });
    setLoading(false);
    if (error) { toast.error('Failed to log overtime'); return; }
    toast.success('Overtime logged');
    onSuccess();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-sm rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-fg">Log overtime</h2>
          <button onClick={onClose} className="rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg-muted"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Work date *</label>
            <input type="date" required value={form.workDate} onChange={(e) => setForm(f => ({ ...f, workDate: e.target.value }))} className={inputClass} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Hours *</label>
            <input type="number" required min={0.5} max={24} step={0.5} value={form.hours}
              onChange={(e) => setForm(f => ({ ...f, hours: Number(e.target.value) }))} className={inputClass} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Reason *</label>
            <textarea value={form.reason} onChange={(e) => setForm(f => ({ ...f, reason: e.target.value }))}
              required rows={2} placeholder="Why was overtime worked?"
              className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="h-8 rounded-md border border-border px-3.5 text-sm font-medium text-fg-muted hover:bg-surface-hover">Cancel</button>
            <button type="submit" disabled={loading} className="h-8 rounded-md bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60">{loading ? 'Saving…' : 'Log'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function OvertimeTab() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<OvertimeStatus | ''>('');
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<OvertimeResponse | null>(null);

  const OT_FILTERS: { value: OvertimeStatus | ''; label: string }[] = [
    { value: '', label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
  ];

  const { data, isLoading, isError } = useQuery({
    queryKey: ['workforce', 'overtime', statusFilter],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/workforce/overtime', {
        params: { query: { status: (statusFilter || undefined) as never, limit: 50 } },
      });
      if (error || !data) throw new Error('Failed to load overtime');
      return data;
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['workforce', 'overtime'] });

  async function handleReview(id: string, approve: boolean) {
    const { error } = await api.POST('/v1/workforce/overtime/{id}/review', {
      params: { path: { id } }, body: { approve },
    });
    if (error) { toast.error(`Failed to ${approve ? 'approve' : 'reject'} overtime`); return; }
    toast.success(`Overtime ${approve ? 'approved' : 'rejected'}`);
    invalidate();
  }

  return (
    <>
      {showForm && <LogOvertimeModal onClose={() => setShowForm(false)} onSuccess={invalidate} />}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1 rounded-lg bg-surface-muted p-1 w-fit">
            {OT_FILTERS.map(({ value, label }) => (
              <button key={value} onClick={() => setStatusFilter(value)}
                className={['rounded-md px-3 py-1 text-sm font-medium transition-colors',
                  statusFilter === value ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg-muted'].join(' ')}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover">
            <Plus className="h-4 w-4" strokeWidth={2} /> Log overtime
          </button>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted">
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Work date</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Hours</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Reason</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-fg-subtle">Loading…</td></tr>}
              {isError && <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-danger">Failed to load overtime records.</td></tr>}
              {data?.data?.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-fg-subtle">No overtime records found</td></tr>}
              {data?.data?.map((o) => (
                <tr
                  key={o.id}
                  className="cursor-pointer hover:bg-surface-hover"
                  onClick={() => setSelected(o as OvertimeResponse)}
                >
                  <td className="px-4 py-3 text-fg">{new Date(o.workDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-fg-muted">{o.hours}h</td>
                  <td className="px-4 py-3 max-w-xs truncate text-xs text-fg-subtle">{o.reason ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge className={OVERTIME_STATUS_CLASS[o.status]}
                      label={o.status.charAt(0).toUpperCase() + o.status.slice(1)} />
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    {o.status === 'pending' && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleReview(o.id, true)} className="rounded px-2 py-1 text-xs font-medium text-success hover:bg-success-bg">Approve</button>
                        <button onClick={() => handleReview(o.id, false)} className="rounded px-2 py-1 text-xs font-medium text-danger hover:bg-danger-bg">Reject</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data?.pageInfo && <div className="border-t border-border bg-surface-muted px-4 py-2.5 text-xs text-fg-subtle">{data.pageInfo.total} record{data.pageInfo.total !== 1 ? 's' : ''}</div>}
        </div>
      </div>
      <SlideOver
        open={!!selected}
        onClose={() => setSelected(null)}
        title="Overtime record"
        description={selected ? `${new Date(selected.workDate).toLocaleDateString()} · ${selected.hours}h` : undefined}
        width="md"
        headerActions={selected?.status === 'pending' ? (
          <div className="flex items-center gap-2">
            <button onClick={() => { handleReview(selected.id, true); setSelected(null); }}
              className="rounded-md bg-success-bg px-3 py-1.5 text-xs font-medium text-success hover:bg-success-bg">Approve</button>
            <button onClick={() => { handleReview(selected.id, false); setSelected(null); }}
              className="rounded-md bg-danger-bg px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger-bg">Reject</button>
          </div>
        ) : undefined}
      >
        {selected && (
          <>
            <SlideOverSection title="Details">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {[
                  { label: 'Work date', value: new Date(selected.workDate).toLocaleDateString() },
                  { label: 'Hours',     value: `${selected.hours}h` },
                  { label: 'Status',    value: <StatusBadge className={OVERTIME_STATUS_CLASS[selected.status]} label={selected.status.charAt(0).toUpperCase() + selected.status.slice(1)} /> },
                ].map(({ label, value }) => (
                  <div key={label}><dt className="text-xs text-fg-subtle">{label}</dt><dd className="mt-0.5 text-fg">{value}</dd></div>
                ))}
              </dl>
              {selected.reason && (
                <div className="mt-4 rounded-md bg-surface-muted px-3 py-2.5 text-sm text-fg-muted">
                  <p className="mb-1 text-xs text-fg-subtle">Reason</p>
                  {selected.reason}
                </div>
              )}
            </SlideOverSection>
            <div className="mx-5 h-px bg-surface-muted" />
            <SlideOverSection title="Activity">
              <ActivityTimeline resourceId={selected.id} resourceType="overtime" />
            </SlideOverSection>
          </>
        )}
      </SlideOver>    </>
  );
}

// ── Shifts tab ────────────────────────────────────────────────────────────────

interface LogShiftModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function LogShiftModal({ onClose, onSuccess }: LogShiftModalProps) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ shiftType: 'night' as ShiftType, startsAt: '', endsAt: '', note: '' });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    // datetime-local returns 'YYYY-MM-DDTHH:MM' — append seconds + Z for ISO 8601
    const toIso = (s: string) => s.length === 16 ? s + ':00.000Z' : s;
    const { error } = await api.POST('/v1/workforce/shifts', {
      body: {
        shiftType: form.shiftType as 'night' | 'on_call' | 'weekend',
        startsAt: toIso(form.startsAt),
        endsAt: toIso(form.endsAt),
        note: form.note || undefined,
      },
    });
    setLoading(false);
    if (error) { toast.error('Failed to log shift'); return; }
    toast.success('Shift logged');
    onSuccess();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-sm rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-fg">Log shift</h2>
          <button onClick={onClose} className="rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg-muted"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Shift type *</label>
            <select value={form.shiftType} onChange={(e) => setForm(f => ({ ...f, shiftType: e.target.value as ShiftType }))}
              className={inputClass}>
              <option value="night">Night</option>
              <option value="on_call">On-call</option>
              <option value="weekend">Weekend</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Starts at *</label>
            <input type="datetime-local" required value={form.startsAt} onChange={(e) => setForm(f => ({ ...f, startsAt: e.target.value }))} className={inputClass} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Ends at *</label>
            <input type="datetime-local" required value={form.endsAt} onChange={(e) => setForm(f => ({ ...f, endsAt: e.target.value }))} className={inputClass} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Note</label>
            <textarea value={form.note} onChange={(e) => setForm(f => ({ ...f, note: e.target.value }))}
              rows={2} placeholder="Optional notes…"
              className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="h-8 rounded-md border border-border px-3.5 text-sm font-medium text-fg-muted hover:bg-surface-hover">Cancel</button>
            <button type="submit" disabled={loading} className="h-8 rounded-md bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60">{loading ? 'Saving…' : 'Log shift'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ShiftsTab() {
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<ShiftType | ''>('');
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<ShiftLogResponse | null>(null);

  const TYPE_FILTERS: { value: ShiftType | ''; label: string }[] = [
    { value: '', label: 'All' },
    { value: 'night', label: 'Night' },
    { value: 'on_call', label: 'On-call' },
    { value: 'weekend', label: 'Weekend' },
  ];

  const { data, isLoading, isError } = useQuery({
    queryKey: ['workforce', 'shifts', typeFilter],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/workforce/shifts', {
        params: { query: { shiftType: (typeFilter || undefined) as never, limit: 50 } },
      });
      if (error || !data) throw new Error('Failed to load shifts');
      return data;
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['workforce', 'shifts'] });

  return (
    <>
      {showForm && <LogShiftModal onClose={() => setShowForm(false)} onSuccess={invalidate} />}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1 rounded-lg bg-surface-muted p-1 w-fit">
            {TYPE_FILTERS.map(({ value, label }) => (
              <button key={value} onClick={() => setTypeFilter(value)}
                className={['rounded-md px-3 py-1 text-sm font-medium transition-colors',
                  typeFilter === value ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg-muted'].join(' ')}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover">
            <Plus className="h-4 w-4" strokeWidth={2} /> Log shift
          </button>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted">
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Type</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Starts</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Ends</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Note</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Logged</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-fg-subtle">Loading…</td></tr>}
              {isError && <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-danger">Failed to load shift records.</td></tr>}
              {data?.data?.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-fg-subtle">No shift records found</td></tr>}
              {data?.data?.map((s) => (
                <tr
                  key={s.id}
                  className="cursor-pointer hover:bg-surface-hover"
                  onClick={() => setSelected(s as ShiftLogResponse)}
                >
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-muted px-2 py-0.5 text-xs font-medium text-fg-muted">
                      <Moon className="h-3 w-3" />
                      {SHIFT_TYPE_LABEL[s.shiftType]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-fg-muted">{new Date(s.startsAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-fg-muted">{new Date(s.endsAt).toLocaleString()}</td>
                  <td className="px-4 py-3 max-w-xs truncate text-xs text-fg-subtle">{s.note ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-fg-subtle">{new Date(s.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data?.pageInfo && <div className="border-t border-border bg-surface-muted px-4 py-2.5 text-xs text-fg-subtle">{data.pageInfo.total} record{data.pageInfo.total !== 1 ? 's' : ''}</div>}
        </div>
      </div>

      <SlideOver
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${SHIFT_TYPE_LABEL[selected.shiftType]} shift` : 'Shift record'}
        description={selected ? `${new Date(selected.startsAt).toLocaleString()} – ${new Date(selected.endsAt).toLocaleString()}` : undefined}
        width="md"
      >
        {selected && (
          <>
            <SlideOverSection title="Details">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {[
                  { label: 'Type',    value: <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-muted px-2 py-0.5 text-xs font-medium text-fg-muted"><Moon className="h-3 w-3" />{SHIFT_TYPE_LABEL[selected.shiftType]}</span> },
                  { label: 'Starts',  value: new Date(selected.startsAt).toLocaleString() },
                  { label: 'Ends',    value: new Date(selected.endsAt).toLocaleString() },
                  { label: 'Logged',  value: new Date(selected.createdAt).toLocaleDateString() },
                ].map(({ label, value }) => (
                  <div key={label}><dt className="text-xs text-fg-subtle">{label}</dt><dd className="mt-0.5 text-fg">{value}</dd></div>
                ))}
              </dl>
              {selected.note && (
                <div className="mt-4 rounded-md bg-surface-muted px-3 py-2.5 text-sm text-fg-muted">
                  <p className="mb-1 text-xs text-fg-subtle">Note</p>
                  {selected.note}
                </div>
              )}
            </SlideOverSection>
            <div className="mx-5 h-px bg-surface-muted" />
            <SlideOverSection title="Activity">
              <ActivityTimeline resourceId={selected.id} resourceType="shift" />
            </SlideOverSection>
          </>
        )}
      </SlideOver>
    </>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────────────

type WorkforceTab = 'timesheets' | 'leave' | 'overtime' | 'shifts';

const TABS: { value: WorkforceTab; label: string; icon: React.FC<{ className?: string }> }[] = [
  { value: 'timesheets', label: 'Timesheets', icon: (p) => <Clock {...p} /> },
  { value: 'leave', label: 'Leave', icon: (p) => <Calendar {...p} /> },
  { value: 'overtime', label: 'Overtime', icon: (p) => <Zap {...p} /> },
  { value: 'shifts', label: 'Shifts', icon: (p) => <Moon {...p} /> },
];

export function WorkforcePage() {
  const [tab, setTab] = useState<WorkforceTab>('timesheets');

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-fg">Workforce</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          Manage timesheets, leave requests, overtime, and special shift logging.
        </p>
      </div>

      {/* Tab bar */}
      <div className="border-b border-border">
        <nav className="-mb-px flex gap-6">
          {TABS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={[
                'flex items-center gap-2 pb-3 text-sm font-medium transition-colors',
                tab === value
                  ? 'border-b-2 border-blue-600 text-accent'
                  : 'border-b-2 border-transparent text-fg-muted hover:text-fg-muted',
              ].join(' ')}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'timesheets' && <TimesheetsTab />}
      {tab === 'leave' && <LeaveTab />}
      {tab === 'overtime' && <OvertimeTab />}
      {tab === 'shifts' && <ShiftsTab />}
    </div>
  );
}
