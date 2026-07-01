import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Search, Pencil, UserPlus, UserMinus, Check, ChevronRight } from 'lucide-react';
import { api } from '@/shared/api/client';
import { SlideOver, SlideOverSection } from '@/shared/ui/slide-over';
import { ActivityTimeline } from '@/shared/ui/activity-timeline';
import { StatusBadge } from '@/shared/ui/status-badge';
import { PageHeader } from '@/shared/ui/page-header';
import { Modal } from '@/shared/ui/modal';
import { PhotoUploadWidget } from '@/shared/ui/photo-upload';
import { cn } from '@/shared/lib/utils';
import type { components } from '@/shared/api/types';

type EmployeeResponse = components['schemas']['EmployeeResponseDto'];
type EquipmentType = NonNullable<components['schemas']['SubmitOnboardingDto']['equipmentType']>;
type PreferredOs = NonNullable<components['schemas']['SubmitOnboardingDto']['preferredOs']>;

// ── Config ────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  on_leave: 'On Leave',
  offboarded: 'Offboarded',
};

const STATUS_CLASS: Record<string, string> = {
  active: 'bg-success-bg text-success',
  on_leave: 'bg-warning-bg text-warning',
  offboarded: 'bg-neutral-bg text-neutral-fg',
};

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'on_leave', label: 'On Leave' },
  { value: 'offboarded', label: 'Offboarded' },
];

const inputClass =
  'h-8 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

const dialogActionsClass = 'flex justify-end gap-2 pt-1';
const cancelBtnClass =
  'h-8 rounded-md border border-border bg-surface px-3.5 text-sm font-medium text-fg-muted hover:bg-surface-hover';

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useEmployees(search: string, status: string) {
  return useQuery({
    queryKey: ['employees', 'list', search, status],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/employees', {
        params: {
          query: {
            search: search || undefined,
            status: (status || undefined) as ('active' | 'on_leave' | 'offboarded') | undefined,
            limit: 100,
          },
        },
      });
      if (error || !data) throw new Error('Failed to load employees');
      return data;
    },
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-muted text-xs font-semibold text-accent-muted-fg">
      {initials}
    </div>
  );
}

function RoleChip({ role }: { role: string }) {
  return (
    <span className="inline-flex items-center rounded-md bg-surface-muted px-2 py-0.5 text-xs font-medium text-fg-muted">
      {role}
    </span>
  );
}

// ── Status select ─────────────────────────────────────────────────────────────

function StatusSelect({
  employee,
  onSuccess,
}: {
  employee: EmployeeResponse;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const status = e.target.value as 'active' | 'on_leave' | 'offboarded';
    setLoading(true);
    await api.PATCH('/v1/employees/{id}/status', {
      params: { path: { id: employee.id } },
      body: { status },
    });
    setLoading(false);
    onSuccess();
  }

  return (
    <select
      value={employee.status}
      onChange={handleChange}
      disabled={loading}
      className={[
        'cursor-pointer rounded-md border-0 py-0.5 pl-2 pr-6 text-xs font-medium',
        'focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-wait',
        STATUS_CLASS[employee.status] ?? 'bg-neutral-bg text-neutral-fg',
      ].join(' ')}
    >
      <option value="active">{STATUS_LABEL.active}</option>
      <option value="on_leave">{STATUS_LABEL.on_leave}</option>
      <option value="offboarded">{STATUS_LABEL.offboarded}</option>
    </select>
  );
}

// ── Employee modal ────────────────────────────────────────────────────────────

interface ModalProps {
  mode: 'create' | 'edit';
  employee?: EmployeeResponse;
  onClose: () => void;
  onSuccess: () => void;
}

function EmployeeModal({ mode, employee, onClose, onSuccess }: ModalProps) {
  // Roles are intentionally NOT edited here. Role assignment is a governance
  // action handled on Settings → Access Control (RBAC), enforced server-side
  // with an escalation guard. The directory modal manages profile fields only.
  const [form, setForm] = useState({
    email: employee?.email ?? '',
    displayName: employee?.displayName ?? '',
    department: employee?.department ?? '',
    jobTitle: employee?.jobTitle ?? '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (mode === 'create') {
      const { error: err } = await api.POST('/v1/employees', {
        body: {
          email: form.email,
          displayName: form.displayName,
          department: form.department || undefined,
          jobTitle: form.jobTitle || undefined,
        },
      });
      if (err) {
        setError('Failed to create employee');
        setLoading(false);
        return;
      }
    } else if (employee) {
      const { error: err } = await api.PATCH('/v1/employees/{id}', {
        params: { path: { id: employee.id } },
        body: {
          displayName: form.displayName,
          department: form.department || null,
          jobTitle: form.jobTitle || null,
        },
      });
      if (err) {
        setError('Failed to update employee');
        setLoading(false);
        return;
      }
    }

    setLoading(false);
    toast.success(mode === 'create' ? 'Employee created' : 'Employee updated');
    onSuccess();
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'Add employee' : 'Edit employee'}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 p-5">
        {mode === 'create' && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Email *</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className={inputClass}
              placeholder="user@company.com"
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-fg-muted">Display name *</label>
          <input
            type="text"
            required
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            className={inputClass}
            placeholder="Jane Smith"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Department</label>
            <input
              type="text"
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
              className={inputClass}
              placeholder="Engineering"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Job title</label>
            <input
              type="text"
              value={form.jobTitle}
              onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
              className={inputClass}
              placeholder="Engineer"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-fg-muted">Roles</label>
          {mode === 'edit' && employee && employee.roles.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {employee.roles.map((r) => (
                <RoleChip key={r} role={r} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-fg-subtle">
              {mode === 'create' ? 'New employees start with no roles.' : 'No roles assigned.'}
            </p>
          )}
          <p className="text-xs text-fg-subtle">
            Roles are managed in{' '}
            <span className="font-medium text-fg-muted">Settings → Access Control</span>.
          </p>
        </div>

        {error && <p className="text-xs text-danger">{error}</p>}

        <div className={dialogActionsClass}>
          <button type="button" onClick={onClose} className={cancelBtnClass}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="h-8 rounded-md bg-accent px-3.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
          >
            {loading ? 'Saving…' : mode === 'create' ? 'Create' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Onboarding wizard ─────────────────────────────────────────────────────────

const WIZARD_STEPS = ['Position', 'Equipment', 'Access', 'Review'] as const;

const EQUIPMENT_OPTIONS = [
  { value: 'laptop', label: 'Laptop', desc: 'Standard mobile workstation' },
  { value: 'desktop', label: 'Desktop', desc: 'Fixed workstation + monitor' },
  { value: 'remote_only', label: 'Remote only', desc: 'No device — uses personal machine' },
  { value: 'byod', label: 'BYOD', desc: 'Bring your own device' },
] as const;

const OS_OPTIONS = [
  { value: 'windows', label: 'Windows' },
  { value: 'macos', label: 'macOS' },
  { value: 'linux', label: 'Linux' },
] as const;

const ACCESS_OPTIONS = [
  'Microsoft 365 / Teams',
  'GitHub / GitLab',
  'Jira / Confluence',
  'Slack',
  'VPN',
  'AWS / Azure console',
  'Database access',
  'Local admin rights',
  'Azure AD PIM role',
];

interface OnboardingModalProps {
  employee: EmployeeResponse;
  onClose: () => void;
  onSuccess: (requestId: string) => void;
}

/** Label/value row for the onboarding review step. Hidden when value is empty. */
function ReviewRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm border-b border-border last:border-0">
      <span className="text-fg-muted shrink-0">{label}</span>
      <span className="text-fg text-right">{value}</span>
    </div>
  );
}

function OnboardingModal({ employee, onClose, onSuccess }: OnboardingModalProps) {
  const [step, setStep] = useState(0);

  // Step 0 — Position
  const [startDate, setStartDate] = useState('');
  const [department, setDepartment] = useState(employee.department ?? '');
  const [jobTitle, setJobTitle] = useState(employee.jobTitle ?? '');
  const [managerName, setManagerName] = useState('');
  const [startDateErr, setStartDateErr] = useState('');

  // Step 1 — Equipment
  const [equipmentType, setEquipmentType] = useState<EquipmentType>('laptop');
  const [preferredOs, setPreferredOs] = useState<PreferredOs>('windows');
  const [equipmentNote, setEquipmentNote] = useState('');

  // Step 2 — Access
  const [accessNeeds, setAccessNeeds] = useState<string[]>(['Microsoft 365 / Teams']);

  const [submitError, setSubmitError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error: err } = await api.POST('/v1/workforce/onboarding', {
        body: {
          employeeId: employee.id,
          startDate,
          department: department || undefined,
          jobTitle: jobTitle || undefined,
          managerName: managerName || undefined,
          equipmentType: equipmentType || undefined,
          preferredOs: preferredOs || undefined,
          equipmentNote: equipmentNote || undefined,
          accessNeeds: accessNeeds.length ? accessNeeds : undefined,
        },
      });
      if (err || !data) throw new Error('Failed to submit onboarding request');
      return data;
    },
    onSuccess: (data) => onSuccess(data.requestId),
    onError: (err: Error) => setSubmitError(err.message),
  });

  function toggleAccess(item: string) {
    setAccessNeeds((prev) =>
      prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item],
    );
  }

  function next() {
    if (step === 0 && !startDate) {
      setStartDateErr('Start date is required');
      return;
    }
    setStartDateErr('');
    setStep((s) => s + 1);
  }

  // Step indicator. These are render helpers (called as functions, not mounted
  // as <Component/>) so they read wizard state via closure without remounting
  // or resetting on each parent render.
  function renderStepBar() {
    return (
      <div className="flex items-center mb-6">
        {WIZARD_STEPS.map((label, i) => (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                  i < step ? 'bg-accent text-accent-fg' : '',
                  i === step ? 'bg-accent text-accent-fg ring-2 ring-accent/30' : '',
                  i > step ? 'bg-surface-muted text-fg-muted border border-border' : '',
                )}
              >
                {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span
                className={cn(
                  'text-[10px] font-medium whitespace-nowrap',
                  i === step ? 'text-fg' : 'text-fg-muted',
                )}
              >
                {label}
              </span>
            </div>
            {i < WIZARD_STEPS.length - 1 && (
              <div className={cn('h-px flex-1 mx-2 mb-4', i < step ? 'bg-accent' : 'bg-border')} />
            )}
          </div>
        ))}
      </div>
    );
  }

  // Step 0: Position
  function renderStepPosition() {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-fg-muted">
            Start date <span className="text-danger">*</span>
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setStartDateErr('');
            }}
            className={cn(
              inputClass,
              startDateErr ? 'border-danger focus:border-danger focus:ring-danger/20' : '',
            )}
          />
          {startDateErr && (
            <p role="alert" className="text-xs text-danger">
              {startDateErr}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Department</label>
            <input
              type="text"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className={inputClass}
              placeholder="Engineering"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Job title</label>
            <input
              type="text"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              className={inputClass}
              placeholder="Software Engineer"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-fg-muted">Direct manager</label>
          <input
            type="text"
            value={managerName}
            onChange={(e) => setManagerName(e.target.value)}
            className={inputClass}
            placeholder="e.g. Jane Smith"
          />
          <p className="text-xs text-fg-subtle">
            The manager who approves step 1 of the onboarding chain.
          </p>
        </div>
      </div>
    );
  }

  // Step 1: Equipment
  function renderStepEquipment() {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-fg-muted">Device type</label>
          <div className="grid grid-cols-2 gap-2">
            {EQUIPMENT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setEquipmentType(opt.value)}
                className={cn(
                  'flex flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                  equipmentType === opt.value
                    ? 'border-accent bg-accent/5 ring-1 ring-accent/30'
                    : 'border-border bg-surface hover:bg-surface-hover',
                )}
              >
                <span className="text-sm font-medium text-fg">{opt.label}</span>
                <span className="text-xs text-fg-muted">{opt.desc}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-fg-muted">Preferred OS</label>
          <div className="flex gap-2">
            {OS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPreferredOs(opt.value)}
                className={cn(
                  'flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
                  preferredOs === opt.value
                    ? 'border-accent bg-accent/5 text-accent ring-1 ring-accent/30'
                    : 'border-border bg-surface text-fg-muted hover:bg-surface-hover',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-fg-muted">Notes for IT</label>
          <textarea
            value={equipmentNote}
            onChange={(e) => setEquipmentNote(e.target.value)}
            rows={2}
            placeholder="e.g. needs external monitor, standing desk adapter…"
            className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>
      </div>
    );
  }

  // Step 2: Access
  function renderStepAccess() {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-fg-muted">
          Select systems the new hire needs access to on day one.
        </p>
        <div className="flex flex-col gap-1.5">
          {ACCESS_OPTIONS.map((item) => {
            const checked = accessNeeds.includes(item);
            return (
              <button
                key={item}
                type="button"
                onClick={() => toggleAccess(item)}
                className={cn(
                  'flex items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                  checked
                    ? 'border-accent bg-accent/5 text-fg'
                    : 'border-border bg-surface text-fg-muted hover:bg-surface-hover',
                )}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    checked ? 'border-accent bg-accent' : 'border-border',
                  )}
                >
                  {checked && <Check className="h-3 w-3 text-white" />}
                </span>
                {item}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Step 3: Review
  function renderStepReview() {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted mb-2">
            Position
          </p>
          <ReviewRow label="Start date" value={startDate} />
          <ReviewRow label="Department" value={department} />
          <ReviewRow label="Job title" value={jobTitle} />
          <ReviewRow label="Manager" value={managerName} />
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted mb-2">
            Equipment
          </p>
          <ReviewRow
            label="Device type"
            value={EQUIPMENT_OPTIONS.find((o) => o.value === equipmentType)?.label}
          />
          <ReviewRow
            label="Preferred OS"
            value={OS_OPTIONS.find((o) => o.value === preferredOs)?.label}
          />
          <ReviewRow label="Notes" value={equipmentNote || undefined} />
        </div>
        {accessNeeds.length > 0 && (
          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted mb-2">
              Access needed
            </p>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {accessNeeds.map((a) => (
                <span
                  key={a}
                  className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent"
                >
                  {a}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="rounded-md border border-border bg-surface-muted px-4 py-3">
          <p className="text-xs text-fg-muted">
            Submitting creates a 3-step approval chain:{' '}
            <strong className="text-fg">Manager → IT → HR</strong>. Track progress under Inbox.
          </p>
        </div>
        {submitError && <p className="text-xs text-danger">{submitError}</p>}
      </div>
    );
  }

  const steps = [
    renderStepPosition(),
    renderStepEquipment(),
    renderStepAccess(),
    renderStepReview(),
  ];

  return (
    <SlideOver
      open
      onClose={onClose}
      width="lg"
      title={`Onboard — ${employee.displayName}`}
      description="Set up position, equipment, and system access for the new hire."
      footer={
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => (step === 0 ? onClose() : setStep((s) => s - 1))}
            className={cancelBtnClass}
          >
            {step === 0 ? 'Cancel' : '← Back'}
          </button>
          {step < WIZARD_STEPS.length - 1 ? (
            <button
              type="button"
              onClick={next}
              className="h-8 inline-flex items-center gap-1.5 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
              className="h-8 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
            >
              {mutation.isPending ? 'Submitting…' : 'Submit onboarding'}
            </button>
          )}
        </div>
      }
    >
      <div className="px-6 py-5">
        {renderStepBar()}
        {steps[step]}
      </div>
    </SlideOver>
  );
}

// ── Offboarding modal ─────────────────────────────────────────────────────────

interface OffboardingModalProps {
  employee: EmployeeResponse;
  onClose: () => void;
  onSuccess: (requestId: string) => void;
}

function OffboardingModal({ employee, onClose, onSuccess }: OffboardingModalProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error: err } = await api.POST('/v1/workforce/offboarding', {
        body: {
          employeeId: employee.id,
          reason: reason || undefined,
        },
      });
      if (err || !data) throw new Error('Failed to submit offboarding request');
      return data;
    },
    onSuccess: (data) => onSuccess(data.requestId),
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Modal open onClose={onClose} title={`Offboard — ${employee.displayName}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <div className="rounded-md border border-warning/30 bg-warning-bg px-4 py-3">
          <p className="text-xs font-medium text-warning">
            This will revoke all access, return assets, and deactivate the employee once approved.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-fg-muted">
            Reason <span className="text-fg-subtle">(optional)</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Resignation, end of contract…"
            className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className={dialogActionsClass}>
          <button type="button" onClick={onClose} className={cancelBtnClass}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="h-8 rounded-md bg-red-600 px-3.5 text-sm font-medium text-white hover:bg-red-700 dark:hover:bg-red-500 disabled:opacity-60"
          >
            {mutation.isPending ? 'Submitting…' : 'Offboard employee'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function PeoplePage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [modal, setModal] = useState<{
    mode: 'create' | 'edit';
    employee?: EmployeeResponse;
  } | null>(null);
  const [onboarding, setOnboarding] = useState<EmployeeResponse | null>(null);
  const [offboarding, setOffboarding] = useState<EmployeeResponse | null>(null);
  const [selectedEmp, setSelectedEmp] = useState<EmployeeResponse | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const employees = useEmployees(search, statusFilter);
  const refetch = () => qc.invalidateQueries({ queryKey: ['employees'] });

  function notifyRequest(requestId: string) {
    toast.success('Request submitted', { description: `ID: ${requestId}` });
    refetch();
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="People"
        description="Employee directory and role management."
        actions={
          <button
            onClick={() => setModal({ mode: 'create' })}
            className="flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            Add employee
          </button>
        }
      />

      {/* Filters */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-1 rounded-lg bg-surface-muted p-1">
          {STATUS_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              className={[
                'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                statusFilter === value
                  ? 'bg-surface text-fg shadow-sm'
                  : 'text-fg-muted hover:text-fg',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative w-64">
          <Search
            className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle"
            strokeWidth={1.75}
          />
          <input
            type="text"
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-full rounded-md border border-border bg-surface pl-8 pr-3 text-sm text-fg placeholder:text-fg-subtle transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted">
              <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-subtle">
                Name
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-subtle">
                Department
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-subtle">
                Job Title
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-subtle">
                Roles
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-subtle">
                Status
              </th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {employees.isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-fg-subtle">
                  Loading…
                </td>
              </tr>
            )}
            {employees.isError && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-danger">
                  Failed to load employees. Is the API running?
                </td>
              </tr>
            )}
            {employees.data?.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-sm text-fg-muted">No employees found</span>
                    <span className="text-xs text-fg-subtle">
                      Add your first employee or adjust the filter
                    </span>
                  </div>
                </td>
              </tr>
            )}
            {employees.data?.data?.map((emp) => (
              <tr
                key={emp.id}
                className="cursor-pointer transition-colors hover:bg-surface-hover"
                onClick={() => {
                  setSelectedEmp(emp);
                  setAvatarUrl(null);
                }}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={emp.displayName} />
                    <div>
                      <div className="font-medium text-fg">{emp.displayName}</div>
                      <div className="text-xs text-fg-subtle">{emp.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-fg-muted">
                  {emp.department ?? <span className="text-fg-subtle">—</span>}
                </td>
                <td className="px-4 py-3 text-fg-muted">
                  {emp.jobTitle ?? <span className="text-fg-subtle">—</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {emp.roles.length ? (
                      emp.roles.map((r) => <RoleChip key={r} role={r} />)
                    ) : (
                      <span className="text-xs text-fg-subtle">—</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <StatusSelect employee={emp} onSuccess={refetch} />
                </td>
                <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    {emp.status === 'active' && (
                      <button
                        onClick={() => setOnboarding(emp)}
                        className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-accent hover:bg-accent-muted"
                        title="Start onboarding"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        Onboard
                      </button>
                    )}
                    {emp.status === 'active' && (
                      <button
                        onClick={() => setOffboarding(emp)}
                        className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-danger hover:bg-danger-bg"
                        title="Start offboarding"
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                        Offboard
                      </button>
                    )}
                    <button
                      onClick={() => setModal({ mode: 'edit', employee: emp })}
                      className="rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg-muted"
                      title="Edit employee"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {employees.data?.pageInfo && (
          <div className="border-t border-border bg-surface-muted px-4 py-2.5 text-xs text-fg-subtle">
            {employees.data.pageInfo.total} employee{employees.data.pageInfo.total !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {modal && (
        <EmployeeModal
          mode={modal.mode}
          employee={modal.employee}
          onClose={() => setModal(null)}
          onSuccess={refetch}
        />
      )}

      {onboarding && (
        <OnboardingModal
          employee={onboarding}
          onClose={() => setOnboarding(null)}
          onSuccess={(requestId) => {
            setOnboarding(null);
            notifyRequest(requestId);
          }}
        />
      )}

      {offboarding && (
        <OffboardingModal
          employee={offboarding}
          onClose={() => setOffboarding(null)}
          onSuccess={(requestId) => {
            setOffboarding(null);
            notifyRequest(requestId);
          }}
        />
      )}

      {/* Employee detail slide-over */}
      <SlideOver
        open={!!selectedEmp}
        onClose={() => setSelectedEmp(null)}
        title={selectedEmp?.displayName ?? 'Employee detail'}
        description={[selectedEmp?.jobTitle, selectedEmp?.department].filter(Boolean).join(' · ')}
        width="lg"
      >
        {selectedEmp && (
          <>
            <SlideOverSection title="Avatar">
              <PhotoUploadWidget
                mode="image"
                currentUrl={avatarUrl}
                presignUrl={`/v1/employees/${selectedEmp.id}/avatar/presign`}
                confirmUrl={`/v1/employees/${selectedEmp.id}/avatar/confirm`}
                accept="image/jpeg,image/png,image/webp"
                onSuccess={(url) => {
                  setAvatarUrl(url);
                  qc.invalidateQueries({ queryKey: ['employees'] });
                }}
                label="Employee photo (JPEG, PNG, WebP · max 5 MB)"
              />
            </SlideOverSection>

            <div className="mx-5 h-px bg-border" />

            <SlideOverSection title="Details">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {[
                  { label: 'Email', value: selectedEmp.email },
                  { label: 'Department', value: selectedEmp.department ?? '—' },
                  { label: 'Job title', value: selectedEmp.jobTitle ?? '—' },
                  {
                    label: 'Status',
                    value: (
                      <StatusBadge
                        tone={
                          selectedEmp.status === 'active'
                            ? 'green'
                            : selectedEmp.status === 'inactive'
                              ? 'neutral'
                              : selectedEmp.status === 'on_leave'
                                ? 'amber'
                                : selectedEmp.status === 'terminated'
                                  ? 'red'
                                  : 'neutral'
                        }
                      >
                        {selectedEmp.status}
                      </StatusBadge>
                    ),
                  },
                  {
                    label: 'Roles',
                    value: (
                      <div className="flex flex-wrap gap-1">
                        {selectedEmp.roles.length ? (
                          selectedEmp.roles.map((r) => <RoleChip key={r} role={r} />)
                        ) : (
                          <span className="text-fg-subtle">—</span>
                        )}
                      </div>
                    ),
                  },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <dt className="text-xs text-fg-subtle">{label}</dt>
                    <dd className="mt-0.5 text-fg">{value}</dd>
                  </div>
                ))}
              </dl>
            </SlideOverSection>

            <div className="mx-5 h-px bg-border" />

            <SlideOverSection title="Activity">
              <ActivityTimeline resourceId={selectedEmp.id} resourceType="employee" />
            </SlideOverSection>
          </>
        )}
      </SlideOver>
    </div>
  );
}
