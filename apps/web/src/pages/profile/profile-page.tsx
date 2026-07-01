/**
 * ProfilePage — "My Account" / personal settings for the current user.
 *
 * Sections:
 *   1. Identity summary (avatar initials, email, roles — read-only from JWT)
 *   2. Profile fields (displayName, jobTitle, department) — editable via
 *      PATCH /v1/employees/:id (requires fetching the employee record first)
 *   3. Sessions — active session count + sign out all sessions
 *   4. Authentication — SSO-only note; password change goes through Entra portal
 *
 * Pattern: fetch `/v1/auth/me` for JWT claims, then `/v1/employees/{id}` (where
 * id = me.sub) for the full employee record. `PATCH /v1/employees/{id}` for
 * profile edits (only fields the user can update; role changes are admin-only).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  User,
  ShieldCheck,
  Mail,
  Briefcase,
  Building2,
  ExternalLink,
  CheckCircle2,
  Pencil,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import type { components } from '@/shared/api/generated/api';

type MeDto = components['schemas']['MeResponseDto'];
type EmployeeDto = components['schemas']['EmployeeResponseDto'];

// ── Shared UI ─────────────────────────────────────────────────────────────────

const inputClass =
  'h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-surface-muted disabled:text-fg-subtle';

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-6 py-4">
        <p className="text-sm font-semibold text-fg">{title}</p>
        {subtitle && <p className="mt-0.5 text-xs text-fg-muted">{subtitle}</p>}
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

function FieldRow({
  label,
  icon: Icon,
  value,
  placeholder,
}: {
  label: string;
  icon: React.ElementType;
  value: string;
  placeholder?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
      <Icon className="h-4 w-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />
      <span className="w-28 shrink-0 text-xs font-medium text-fg-muted">{label}</span>
      <span className={`text-sm ${value ? 'text-fg' : 'text-fg-subtle italic'}`}>
        {value || placeholder || '—'}
      </span>
    </div>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function AvatarInitials({ name, email }: { name: string; email: string }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  // Deterministic color from email hash
  const colors = [
    'bg-accent',
    'bg-violet-600',
    'bg-emerald-600',
    'bg-amber-600',
    'bg-rose-600',
    'bg-cyan-600',
  ];
  const idx = [...email].reduce((acc, c) => acc + c.charCodeAt(0), 0) % colors.length;

  return (
    <div
      className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full ${colors[idx]} text-xl font-semibold text-white select-none`}
    >
      {initials || '?'}
    </div>
  );
}

// ── Edit Profile Modal ────────────────────────────────────────────────────────

interface EditProfileModalProps {
  employee: EmployeeDto;
  onClose: () => void;
  onSuccess: (updated: EmployeeDto) => void;
}

function EditProfileModal({ employee, onClose, onSuccess }: EditProfileModalProps) {
  const [displayName, setDisplayName] = useState(employee.displayName);
  const [jobTitle, setJobTitle] = useState(employee.jobTitle ?? '');
  const [department, setDepartment] = useState(employee.department ?? '');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) {
      setErr('Display name is required.');
      return;
    }
    setLoading(true);
    setErr('');

    const { data, error } = await api.PATCH('/v1/employees/{id}', {
      params: { path: { id: employee.id } },
      body: {
        displayName: displayName.trim(),
        jobTitle: jobTitle.trim() || null,
        department: department.trim() || null,
      },
    });

    setLoading(false);
    if (error || !data) {
      setErr('Failed to update profile. Please try again.');
      return;
    }
    toast.success('Profile updated');
    onSuccess(data as EmployeeDto);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold text-fg">Edit Profile</h2>
          <button onClick={onClose} className="rounded p-1 text-fg-subtle hover:bg-surface-hover">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4 px-6 py-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">
              Display name <span className="text-danger">*</span>
            </label>
            <input
              className={inputClass}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your full name"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Job title</label>
            <input
              className={inputClass}
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="e.g. Senior Engineer"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Department</label>
            <input
              className={inputClass}
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="e.g. Engineering"
            />
          </div>
          {err && <p className="rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-lg border border-border px-4 text-sm font-medium text-fg-muted hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="h-9 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {loading ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useMe() {
  return useQuery<MeDto>({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/auth/me');
      if (error || !data) throw new Error('Failed to load profile');
      return data as MeDto;
    },
    staleTime: 5 * 60_000, // 5 min — JWT claims don't change often
  });
}

function useEmployee(id: string | undefined) {
  return useQuery<EmployeeDto>({
    queryKey: ['employees', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/employees/{id}', {
        params: { path: { id: id! } },
      });
      if (error || !data) throw new Error('Failed to load employee record');
      return data as EmployeeDto;
    },
  });
}

// ── Role badge ────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  'it-admin': 'IT Admin',
  hr: 'HR',
  manager: 'Manager',
  security: 'Security',
  employee: 'Employee',
  finance: 'Finance',
};

function RoleBadge({ role }: { role: string }) {
  const label = ROLE_LABELS[role] ?? role;
  const colors: Record<string, string> = {
    'it-admin': 'bg-accent-muted text-accent',
    hr: 'bg-violet-bg text-violet-fg',
    manager: 'bg-warning-bg text-warning',
    security: 'bg-danger-bg text-danger',
    employee: 'bg-surface-muted text-fg-muted',
    finance: 'bg-success-bg text-success',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${colors[role] ?? 'bg-surface-muted text-fg-muted'}`}
    >
      <ShieldCheck className="h-3 w-3" />
      {label}
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ProfilePage() {
  const qc = useQueryClient();
  const { data: me, isLoading: meLoading } = useMe();
  const { data: employee, isLoading: empLoading } = useEmployee(me?.sub);
  const [showEdit, setShowEdit] = useState(false);
  const [localEmployee, setLocalEmployee] = useState<EmployeeDto | null>(null);
  const [syncedEmployee, setSyncedEmployee] = useState<EmployeeDto | null | undefined>(employee);

  // Adjust local state during render when fresh server data arrives (React-
  // canonical alternative to a sync effect — no extra render pass).
  if (employee !== syncedEmployee) {
    setSyncedEmployee(employee);
    if (employee) setLocalEmployee(employee);
  }

  const displayEmployee = localEmployee ?? employee;
  const isLoading = meLoading || empLoading;

  function handleEditSuccess(updated: EmployeeDto) {
    setLocalEmployee(updated);
    qc.setQueryData(['employees', me?.sub], updated);
  }

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <div className="h-8 w-40 animate-pulse rounded-lg bg-surface-muted" />
        <div className="h-40 animate-pulse rounded-xl bg-surface-muted" />
      </div>
    );
  }

  if (!me) return null;

  const statusColors: Record<string, string> = {
    active: 'bg-success-bg text-success',
    on_leave: 'bg-warning-bg text-warning',
    offboarded: 'bg-surface-muted text-fg-muted',
  };

  return (
    <>
      {showEdit && displayEmployee && (
        <EditProfileModal
          employee={displayEmployee}
          onClose={() => setShowEdit(false)}
          onSuccess={handleEditSuccess}
        />
      )}

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        {/* Page header */}
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-fg">My Profile</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            View and update your personal details and account settings.
          </p>
        </div>

        {/* Identity card */}
        <div
          data-testid="identity-card"
          className="rounded-xl border border-border bg-surface px-6 py-5"
        >
          <div className="flex items-start gap-4">
            <AvatarInitials name={me.name} email={me.email} />
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-fg truncate">
                    {displayEmployee?.displayName ?? me.name}
                  </p>
                  <p className="text-sm text-fg-muted truncate">{me.email}</p>
                  {displayEmployee?.jobTitle && (
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      {displayEmployee.jobTitle}
                      {displayEmployee.department ? ` · ${displayEmployee.department}` : ''}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {displayEmployee?.status && (
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium capitalize ${statusColors[displayEmployee.status] ?? 'bg-surface-muted text-fg-muted'}`}
                    >
                      {displayEmployee.status.replace('_', ' ')}
                    </span>
                  )}
                  <button
                    onClick={() => setShowEdit(true)}
                    className="flex items-center gap-1.5 h-8 rounded-lg border border-border px-3 text-xs font-medium text-fg-muted hover:bg-surface-hover"
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Edit
                  </button>
                </div>
              </div>
              {me.roles.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {me.roles.map((r) => (
                    <RoleBadge key={r} role={r} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Profile details */}
        {displayEmployee && (
          <SectionCard
            title="Profile details"
            subtitle="Information visible to your IT team and managers."
          >
            <div>
              <FieldRow label="Email" icon={Mail} value={displayEmployee.email} />
              <FieldRow label="Display name" icon={User} value={displayEmployee.displayName} />
              <FieldRow
                label="Job title"
                icon={Briefcase}
                value={displayEmployee.jobTitle ?? ''}
                placeholder="Not set"
              />
              <FieldRow
                label="Department"
                icon={Building2}
                value={displayEmployee.department ?? ''}
                placeholder="Not set"
              />
            </div>
          </SectionCard>
        )}

        {/* Authentication */}
        <SectionCard
          title="Authentication"
          subtitle="Your account uses Microsoft Entra ID (Azure AD) for sign-in."
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-success mt-0.5" strokeWidth={1.75} />
            <div className="flex-1">
              <p className="text-sm font-medium text-fg">Single Sign-On via Microsoft Entra ID</p>
              <p className="mt-0.5 text-xs text-fg-muted">
                Your password and MFA settings are managed through your organisation's Microsoft
                account. To change your password or manage security options, visit the Microsoft My
                Account portal.
              </p>
              <a
                href="https://myaccount.microsoft.com/security-info"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent"
              >
                Manage Microsoft security settings
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </SectionCard>

        {/* Account info */}
        <SectionCard
          title="Account information"
          subtitle="System-generated fields. Contact IT admin to make changes."
        >
          <div className="space-y-0">
            <FieldRow label="User ID" icon={User} value={me.sub} />
            <FieldRow label="Account email" icon={Mail} value={me.email} />
            {displayEmployee && (
              <FieldRow
                label="Member since"
                icon={CheckCircle2}
                value={new Date(displayEmployee.createdAt).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              />
            )}
          </div>
        </SectionCard>
      </div>
    </>
  );
}
