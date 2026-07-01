/**
 * DashboardPage — persona-aware home screen.
 *
 * Each persona sees a different widget grid, driven by their primary role.
 * Every widget fetches its own data independently (TanStack Query).
 * Unknown/loading role → skeleton until resolved.
 */
import { useQuery } from '@tanstack/react-query';
import {
  Laptop,
  ShieldCheck,
  ScanLine,
  CalendarClock,
  TrendingUp,
  ArrowRight,
  Inbox,
  Users,
  BarChart2,
  AlertTriangle,
  CheckCircle,
  ShieldAlert,
  UserCog,
  Webhook,
  DollarSign,
  Settings2,
} from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { api } from '@/shared/api/client';
import { usePermissions, type AppRole } from '@/shared/hooks/use-permissions';
import { useCurrentUser } from '@/shared/hooks/use-current-user';
import { PageHeader } from '@/shared/ui/page-header';
import { cn } from '@/shared/lib/utils';

// ── Accent tones (token-class, dark-aware — no inline hex) ──────────────────────

type Accent = 'blue' | 'amber' | 'violet' | 'red' | 'green';

const ACCENT: Record<Accent, string> = {
  blue: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400',
  red: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400',
  green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
};

// ── Shared primitives ─────────────────────────────────────────────────────────

type IconType = React.ComponentType<{ className?: string; strokeWidth?: number }>;

interface StatTileProps {
  label: string;
  value: string | number | undefined;
  loading?: boolean;
  icon: IconType;
  tone: Accent;
  to: string;
  variant?: 'default' | 'alert';
}

function StatTile({
  label,
  value,
  loading,
  icon: Icon,
  tone,
  to,
  variant = 'default',
}: StatTileProps) {
  const isAlert = variant === 'alert' && typeof value === 'number' && value > 0;
  return (
    <Link
      to={to}
      className={cn(
        'group flex flex-col gap-3 rounded-lg border bg-surface p-5 transition-shadow hover:shadow-md',
        isAlert ? 'border-danger/40 ring-1 ring-danger/15' : 'border-border',
      )}
    >
      <div className="flex items-start justify-between">
        <div
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg',
            isAlert ? ACCENT.red : ACCENT[tone],
          )}
        >
          <Icon className="h-4.5 w-4.5" strokeWidth={1.75} />
        </div>
        <ArrowRight
          className="h-4 w-4 text-fg-subtle transition-colors group-hover:text-fg-muted"
          strokeWidth={1.75}
        />
      </div>
      <div>
        <div
          className={cn(
            'tabular-nums text-2xl font-semibold tracking-tight',
            isAlert ? 'text-danger' : 'text-fg',
          )}
        >
          {loading ? (
            <span className="inline-block h-7 w-8 animate-pulse rounded bg-surface-hover" />
          ) : (
            (value ?? '—')
          )}
        </div>
        <div className="mt-0.5 text-sm text-fg-muted">{label}</div>
      </div>
    </Link>
  );
}

function SectionCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: IconType;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
        <Icon className="h-4 w-4 text-fg-subtle" strokeWidth={1.75} />
        <span className="text-sm font-medium text-fg">{title}</span>
      </div>
      {children}
    </div>
  );
}

function DomainLink({
  label,
  sub,
  to,
  icon: Icon,
  tone,
}: {
  label: string;
  sub: string;
  to: string;
  icon: IconType;
  tone: Accent;
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface-hover"
    >
      <div
        className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', ACCENT[tone])}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-fg">{label}</div>
        <div className="text-xs text-fg-subtle">{sub}</div>
      </div>
      <ArrowRight
        className="h-3.5 w-3.5 shrink-0 text-fg-subtle transition-colors group-hover:text-fg-muted"
        strokeWidth={1.75}
      />
    </Link>
  );
}

// ── Data hooks ────────────────────────────────────────────────────────────────

function useAssetCount() {
  return useQuery({
    queryKey: ['assets', 'count'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/assets', { params: { query: { limit: 1 } } });
      if (error || !data) throw new Error();
      return data.pageInfo?.total ?? 0;
    },
    staleTime: 60_000,
  });
}

function useMyQueueCount() {
  return useQuery({
    queryKey: ['requests', 'my-queue-count'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/requests', {
        params: { query: { myQueue: true, status: 'pending', limit: 1 } as never },
      });
      if (error) throw new Error();
      const res = data as unknown as { pageInfo?: { total?: number } };
      return res?.pageInfo?.total ?? 0;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

function usePendingAccessCount() {
  return useQuery({
    queryKey: ['access-requests', 'pending-count'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/access-requests', {
        params: { query: { status: 'pending', limit: 1 } },
      });
      if (error || !data) throw new Error();
      return data.pageInfo?.total ?? 0;
    },
    staleTime: 60_000,
  });
}

function useOpenFindingsCount() {
  return useQuery({
    queryKey: ['compliance', 'open-findings-count'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/compliance/findings', {
        params: { query: { status: 'open', limit: 1 } as never },
      });
      if (error || !data) throw new Error();
      return data.pageInfo?.total ?? 0;
    },
    staleTime: 120_000,
  });
}

function usePendingLeaveCount() {
  return useQuery({
    queryKey: ['workforce', 'pending-leave-count'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/workforce/leave', {
        params: { query: { status: 'pending', limit: 1 } as never },
      });
      if (error || !data) throw new Error();
      return data.pageInfo?.total ?? 0;
    },
    staleTime: 60_000,
  });
}

// ── Persona dashboards ────────────────────────────────────────────────────────

function AdminDashboard() {
  // Platform Administrator (super-admin) — owns the OpsHub application itself.
  // Sees the full operational picture plus platform-governance surfaces that
  // operational roles (it-admin etc.) do not control: RBAC, audit, webhooks, FinOps.
  const assets = useAssetCount();
  const pendingAcc = usePendingAccessCount();
  const findings = useOpenFindingsCount();
  const myQueue = useMyQueueCount();
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Hardware assets"
          value={assets.data}
          loading={assets.isLoading}
          icon={Laptop}
          tone="blue"
          to="/assets"
        />
        <StatTile
          label="Pending access grants"
          value={pendingAcc.data}
          loading={pendingAcc.isLoading}
          icon={ShieldCheck}
          tone="violet"
          to="/access"
          variant="alert"
        />
        <StatTile
          label="Open compliance issues"
          value={findings.data}
          loading={findings.isLoading}
          icon={ScanLine}
          tone="red"
          to="/compliance"
          variant="alert"
        />
        <StatTile
          label="Awaiting my approval"
          value={myQueue.data}
          loading={myQueue.isLoading}
          icon={Inbox}
          tone="amber"
          to="/requests"
          variant="alert"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="Platform Governance" icon={Settings2}>
          <div className="divide-y divide-border">
            <DomainLink
              label="Access Control"
              sub="Roles, permissions and assignments"
              to="/settings/access-control"
              icon={UserCog}
              tone="violet"
            />
            <DomainLink
              label="Audit Logs"
              sub="Immutable activity trail"
              to="/settings/audit-logs"
              icon={ShieldAlert}
              tone="red"
            />
            <DomainLink
              label="Webhooks"
              sub="Outbound integrations"
              to="/settings/webhooks"
              icon={Webhook}
              tone="blue"
            />
            <DomainLink
              label="FinOps"
              sub="License spend and utilization"
              to="/finops"
              icon={DollarSign}
              tone="green"
            />
          </div>
        </SectionCard>
        <SectionCard title="Operations" icon={TrendingUp}>
          <div className="divide-y divide-border">
            <DomainLink
              label="Assets"
              sub="Hardware inventory and lifecycle"
              to="/assets"
              icon={Laptop}
              tone="blue"
            />
            <DomainLink
              label="Access Requests"
              sub="Temp admin and privileged access"
              to="/access"
              icon={ShieldCheck}
              tone="amber"
            />
            <DomainLink
              label="Compliance"
              sub="Endpoint findings and drift"
              to="/compliance"
              icon={ScanLine}
              tone="red"
            />
            <DomainLink
              label="People"
              sub="Employee directory and lifecycle"
              to="/people"
              icon={Users}
              tone="violet"
            />
          </div>
        </SectionCard>
      </div>
    </>
  );
}

function ItAdminDashboard() {
  const assets = useAssetCount();
  const myQueue = useMyQueueCount();
  const pendingAcc = usePendingAccessCount();
  const findings = useOpenFindingsCount();
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Hardware assets"
          value={assets.data}
          loading={assets.isLoading}
          icon={Laptop}
          tone="blue"
          to="/assets"
        />
        <StatTile
          label="Awaiting my approval"
          value={myQueue.data}
          loading={myQueue.isLoading}
          icon={Inbox}
          tone="amber"
          to="/requests"
          variant="alert"
        />
        <StatTile
          label="Pending access grants"
          value={pendingAcc.data}
          loading={pendingAcc.isLoading}
          icon={ShieldCheck}
          tone="violet"
          to="/access"
          variant="alert"
        />
        <StatTile
          label="Open compliance issues"
          value={findings.data}
          loading={findings.isLoading}
          icon={ScanLine}
          tone="red"
          to="/compliance"
          variant="alert"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="IT Operations" icon={TrendingUp}>
          <div className="divide-y divide-border">
            <DomainLink
              label="Assets"
              sub="Hardware inventory and lifecycle"
              to="/assets"
              icon={Laptop}
              tone="blue"
            />
            <DomainLink
              label="Access Requests"
              sub="Temp admin and privileged access"
              to="/access"
              icon={ShieldCheck}
              tone="amber"
            />
            <DomainLink
              label="Compliance"
              sub="Endpoint findings and drift"
              to="/compliance"
              icon={ScanLine}
              tone="red"
            />
            <DomainLink
              label="Requests Inbox"
              sub="All approval items"
              to="/requests"
              icon={Inbox}
              tone="violet"
            />
          </div>
        </SectionCard>
        <SectionCard title="People & Workforce" icon={Users}>
          <div className="divide-y divide-border">
            <DomainLink
              label="People"
              sub="Employee directory and lifecycle"
              to="/people"
              icon={Users}
              tone="blue"
            />
            <DomainLink
              label="Workforce"
              sub="Leave, OT and timesheets"
              to="/workforce"
              icon={CalendarClock}
              tone="violet"
            />
            <DomainLink
              label="Reports"
              sub="Analytics and audit evidence"
              to="/reports"
              icon={BarChart2}
              tone="green"
            />
          </div>
        </SectionCard>
      </div>
    </>
  );
}

function SecurityDashboard() {
  const findings = useOpenFindingsCount();
  const pendingAcc = usePendingAccessCount();
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="Open compliance findings"
          value={findings.data}
          loading={findings.isLoading}
          icon={AlertTriangle}
          tone="red"
          to="/compliance"
          variant="alert"
        />
        <StatTile
          label="Pending access grants"
          value={pendingAcc.data}
          loading={pendingAcc.isLoading}
          icon={ShieldCheck}
          tone="amber"
          to="/access"
        />
        <StatTile label="People" icon={Users} tone="blue" to="/people" value={undefined} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="Security Ops" icon={ShieldAlert}>
          <div className="divide-y divide-border">
            <DomainLink
              label="Compliance"
              sub="Endpoint findings and drift"
              to="/compliance"
              icon={ScanLine}
              tone="red"
            />
            <DomainLink
              label="Access Requests"
              sub="Privileged access and PIM grants"
              to="/access"
              icon={ShieldCheck}
              tone="amber"
            />
            <DomainLink
              label="Audit Logs"
              sub="Immutable event trail"
              to="/settings/audit-logs"
              icon={ShieldAlert}
              tone="violet"
            />
          </div>
        </SectionCard>
        <SectionCard title="Reports" icon={BarChart2}>
          <div className="divide-y divide-border">
            <DomainLink
              label="Reports"
              sub="Compliance %, SLA, OT trends"
              to="/reports"
              icon={BarChart2}
              tone="green"
            />
            <DomainLink
              label="People"
              sub="Employee directory"
              to="/people"
              icon={Users}
              tone="blue"
            />
          </div>
        </SectionCard>
      </div>
    </>
  );
}

function ManagerDashboard() {
  const myQueue = useMyQueueCount();
  const pendingLv = usePendingLeaveCount();
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="Awaiting my approval"
          value={myQueue.data}
          loading={myQueue.isLoading}
          icon={Inbox}
          tone="amber"
          to="/requests"
          variant="alert"
        />
        <StatTile
          label="Pending leave"
          value={pendingLv.data}
          loading={pendingLv.isLoading}
          icon={CalendarClock}
          tone="violet"
          to="/workforce"
          variant="alert"
        />
        <StatTile label="Team directory" icon={Users} tone="blue" to="/people" value={undefined} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="Approvals" icon={CheckCircle}>
          <div className="divide-y divide-border">
            <DomainLink
              label="Requests Inbox"
              sub="Items awaiting my decision"
              to="/requests"
              icon={Inbox}
              tone="amber"
            />
            <DomainLink
              label="Workforce"
              sub="Leave and OT approvals"
              to="/workforce"
              icon={CalendarClock}
              tone="violet"
            />
          </div>
        </SectionCard>
        <SectionCard title="Team" icon={Users}>
          <div className="divide-y divide-border">
            <DomainLink
              label="People"
              sub="Employee directory"
              to="/people"
              icon={Users}
              tone="blue"
            />
            <DomainLink
              label="Reports"
              sub="Team analytics and insights"
              to="/reports"
              icon={BarChart2}
              tone="green"
            />
          </div>
        </SectionCard>
      </div>
    </>
  );
}

function HrDashboard() {
  const pendingLv = usePendingLeaveCount();
  const myQueue = useMyQueueCount();
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label="Pending leave requests"
          value={pendingLv.data}
          loading={pendingLv.isLoading}
          icon={CalendarClock}
          tone="violet"
          to="/workforce"
          variant="alert"
        />
        <StatTile
          label="Awaiting my approval"
          value={myQueue.data}
          loading={myQueue.isLoading}
          icon={Inbox}
          tone="amber"
          to="/requests"
          variant="alert"
        />
        <StatTile label="People" icon={Users} tone="blue" to="/people" value={undefined} />
      </div>
      <SectionCard title="Workforce" icon={CalendarClock}>
        <div className="divide-y divide-border">
          <DomainLink
            label="Workforce"
            sub="Leave, OT and timesheets"
            to="/workforce"
            icon={CalendarClock}
            tone="violet"
          />
          <DomainLink
            label="People"
            sub="Employee directory"
            to="/people"
            icon={Users}
            tone="blue"
          />
          <DomainLink
            label="Reports"
            sub="Workforce analytics"
            to="/reports"
            icon={BarChart2}
            tone="green"
          />
        </div>
      </SectionCard>
    </>
  );
}

function AuditorDashboard() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <SectionCard title="Evidence & Audit" icon={ShieldAlert}>
        <div className="divide-y divide-border">
          <DomainLink
            label="Audit Logs"
            sub="Immutable event trail"
            to="/settings/audit-logs"
            icon={ShieldAlert}
            tone="violet"
          />
          <DomainLink
            label="Compliance"
            sub="Findings and posture"
            to="/compliance"
            icon={ScanLine}
            tone="red"
          />
          <DomainLink
            label="Reports"
            sub="Compliance % and SLA evidence"
            to="/reports"
            icon={BarChart2}
            tone="green"
          />
        </div>
      </SectionCard>
      <SectionCard title="Directory" icon={Users}>
        <div className="divide-y divide-border">
          <DomainLink
            label="People"
            sub="Employee directory (read-only)"
            to="/people"
            icon={Users}
            tone="blue"
          />
          <DomainLink
            label="Assets"
            sub="Hardware inventory (read-only)"
            to="/assets"
            icon={Laptop}
            tone="blue"
          />
        </div>
      </SectionCard>
    </div>
  );
}

function EmployeeDashboard({ name }: { name?: string }) {
  const myQueue = useMyQueueCount();
  return (
    <>
      {name && (
        <p className="text-sm text-fg-muted">
          Welcome back, <span className="font-medium text-fg">{name.split(' ')[0]}</span>. Here's
          your overview.
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatTile
          label="My open requests"
          value={myQueue.data}
          loading={myQueue.isLoading}
          icon={Inbox}
          tone="amber"
          to="/requests"
        />
        <StatTile label="My devices" icon={Laptop} tone="blue" to="/assets" value={undefined} />
      </div>
      <SectionCard title="Quick access" icon={TrendingUp}>
        <div className="divide-y divide-border">
          <DomainLink
            label="Requests"
            sub="My submitted requests and status"
            to="/requests"
            icon={Inbox}
            tone="amber"
          />
          <DomainLink
            label="Workforce"
            sub="My leave and overtime"
            to="/workforce"
            icon={CalendarClock}
            tone="violet"
          />
          <DomainLink
            label="Assets"
            sub="My assigned devices"
            to="/assets"
            icon={Laptop}
            tone="blue"
          />
        </div>
      </SectionCard>
    </>
  );
}

// ── Role → display label ──────────────────────────────────────────────────────

const ROLE_TITLE: Record<AppRole, string> = {
  admin: 'Platform Admin',
  'it-admin': 'IT Admin',
  security: 'Security',
  manager: 'Manager',
  hr: 'HR',
  auditor: 'Auditor',
  helpdesk: 'Helpdesk',
  employee: 'Employee',
};

// ── Page ──────────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { primaryRole, isLoading } = usePermissions();
  const { data: me } = useCurrentUser();

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        title={isLoading ? 'Overview' : `Overview · ${ROLE_TITLE[primaryRole] ?? 'Employee'}`}
        description="Operations summary across IT and HR domains."
        actions={
          <div className="flex items-center gap-1.5 rounded-md bg-success-bg px-2.5 py-1.5 text-xs font-medium text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            API connected
          </div>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-lg border border-border bg-surface-muted"
            />
          ))}
        </div>
      ) : (
        <>
          {primaryRole === 'admin' && <AdminDashboard />}
          {primaryRole === 'it-admin' && <ItAdminDashboard />}
          {primaryRole === 'security' && <SecurityDashboard />}
          {primaryRole === 'manager' && <ManagerDashboard />}
          {primaryRole === 'hr' && <HrDashboard />}
          {primaryRole === 'auditor' && <AuditorDashboard />}
          {(primaryRole === 'employee' || primaryRole === 'helpdesk') && (
            <EmployeeDashboard name={me?.name} />
          )}
        </>
      )}
    </div>
  );
}
