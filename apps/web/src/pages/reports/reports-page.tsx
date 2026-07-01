/**
 * ReportsPage — analytics & KPI dashboard.
 *
 * Sections:
 *  1. Request throughput   — daily submitted vs resolved (area chart)
 *  2. SLA compliance       — per request-type compliance rate (bar chart)
 *  3. Cycle time           — p50 / p90 hours per type (bar chart)
 *  4. Queue depth          — current pending/in-review breakdown (table)
 *  5. Asset utilization    — % assigned per asset type (bar chart)
 *  6. Compliance findings  — open by severity (donut chart)
 *  7. Workforce leave      — leave count breakdown
 *
 * Uses recharts (already installed) — AreaChart, BarChart, PieChart.
 * Date range: last 30 days by default, settable via dropdown.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { api } from '@/shared/api/client';
import type {
  ThroughputResponse,
  SlaComplianceResponse,
  CycleTimeResponse,
  QueueDepthResponse,
  AssetUtilizationResponse,
  FindingsSummaryResponse,
  LeaveSummaryResponse,
  OvertimeSummaryResponse,
} from '@/shared/api/types';

// ── Constants ─────────────────────────────────────────────────────────────────

const BLUE = '#2563eb';
const GREEN = '#16a34a';
const AMBER = '#d97706';
const RED = '#dc2626';
const VIOLET = '#7c3aed';
const ZINC = '#71717a';

const SEVERITY_COLORS: Record<string, string> = {
  critical: RED,
  high: AMBER,
  medium: '#f59e0b',
  low: '#84cc16',
};

const DAYS_OPTIONS = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function dateRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(Date.now() - days * 86_400_000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function shortDay(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function capitalize(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Shared card shell ─────────────────────────────────────────────────────────

function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-surface ${className}`}>
      <div className="border-b border-border px-5 py-3.5">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function ChartSkeleton() {
  return <div className="h-48 animate-pulse rounded-lg bg-surface-muted" />;
}

function ErrorMsg() {
  return <p className="py-4 text-center text-xs text-danger">Failed to load data</p>;
}

// ── Section 1: Throughput area chart ──────────────────────────────────────────

function ThroughputChart({ days }: { days: number }) {
  const { from, to } = dateRange(days);
  const { data, isLoading, isError } = useQuery<ThroughputResponse>({
    queryKey: ['reports', 'throughput', days],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/reports/requests/throughput', {
        params: { query: { from, to } },
      });
      if (error || !data) throw new Error();
      return data;
    },
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <ChartSkeleton />;
  if (isError || !data) return <ErrorMsg />;

  const chartData = data.points.map((p) => ({
    day: shortDay(p.day),
    submitted: p.submitted,
    resolved: p.resolved,
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="gradSubmitted" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={BLUE} stopOpacity={0.15} />
            <stop offset="95%" stopColor={BLUE} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradResolved" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={GREEN} stopOpacity={0.15} />
            <stop offset="95%" stopColor={GREEN} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
        <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#a1a1aa' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e4e4e7' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Area type="monotone" dataKey="submitted" name="Submitted" stroke={BLUE} fill="url(#gradSubmitted)" strokeWidth={2} dot={false} />
        <Area type="monotone" dataKey="resolved" name="Resolved" stroke={GREEN} fill="url(#gradResolved)" strokeWidth={2} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Section 2: SLA compliance bar chart ───────────────────────────────────────

function SlaChart({ days }: { days: number }) {
  const { from, to } = dateRange(days);
  const { data, isLoading, isError } = useQuery<SlaComplianceResponse>({
    queryKey: ['reports', 'sla', days],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/reports/requests/sla-compliance', {
        params: { query: { from, to } },
      });
      if (error || !data) throw new Error();
      return data;
    },
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <ChartSkeleton />;
  if (isError || !data) return <ErrorMsg />;

  const chartData = data.rows.map((r) => ({
    type: capitalize(r.type),
    'Within SLA': r.withinSla,
    'Breached': r.breached,
    'Rate': r.complianceRatePct ?? 0,
  }));

  if (!chartData.length) return <p className="py-4 text-center text-xs text-fg-subtle">No SLA data for this period</p>;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
        <XAxis dataKey="type" tick={{ fontSize: 10, fill: '#a1a1aa' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e4e4e7' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="Within SLA" fill={GREEN} radius={[3, 3, 0, 0]} />
        <Bar dataKey="Breached" fill={RED} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Section 3: Cycle time ─────────────────────────────────────────────────────

function CycleTimeChart({ days }: { days: number }) {
  const { from, to } = dateRange(days);
  const { data, isLoading, isError } = useQuery<CycleTimeResponse>({
    queryKey: ['reports', 'cycle-time', days],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/reports/requests/cycle-time', {
        params: { query: { from, to } },
      });
      if (error || !data) throw new Error();
      return data;
    },
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <ChartSkeleton />;
  if (isError || !data) return <ErrorMsg />;

  const chartData = data.rows.map((r) => ({
    type: capitalize(r.type),
    'p50 (h)': Math.round(r.p50Hours),
    'p90 (h)': Math.round(r.p90Hours),
  }));

  if (!chartData.length) return <p className="py-4 text-center text-xs text-fg-subtle">No cycle time data for this period</p>;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
        <XAxis dataKey="type" tick={{ fontSize: 10, fill: '#a1a1aa' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e4e4e7' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="p50 (h)" fill={BLUE} radius={[3, 3, 0, 0]} />
        <Bar dataKey="p90 (h)" fill={VIOLET} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Section 4: Queue depth table ──────────────────────────────────────────────

function QueueTable() {
  const { data, isLoading, isError } = useQuery<QueueDepthResponse>({
    queryKey: ['reports', 'queue'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/reports/requests/queue');
      if (error || !data) throw new Error();
      return data;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  if (isLoading) return <div className="h-24 animate-pulse rounded-lg bg-surface-muted" />;
  if (isError || !data) return <ErrorMsg />;

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-border">
          <th className="pb-2 text-left font-medium text-fg-muted">Type</th>
          <th className="pb-2 text-right font-medium text-fg-muted">Pending</th>
          <th className="pb-2 text-right font-medium text-fg-muted">In Review</th>
          <th className="pb-2 text-right font-medium text-warning">At Risk</th>
          <th className="pb-2 text-right font-medium text-fg-muted">Total</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {data.rows.map((r) => (
          <tr key={r.type}>
            <td className="py-2 text-fg-muted">{capitalize(r.type)}</td>
            <td className="py-2 text-right tabular-nums text-fg-muted">{r.pending}</td>
            <td className="py-2 text-right tabular-nums text-fg-muted">{r.inReview}</td>
            <td className={`py-2 text-right tabular-nums font-medium ${r.atRisk > 0 ? 'text-warning' : 'text-fg-subtle'}`}>{r.atRisk}</td>
            <td className="py-2 text-right tabular-nums font-semibold text-fg">{r.total}</td>
          </tr>
        ))}
        {data.rows.length === 0 && (
          <tr><td colSpan={5} className="py-4 text-center text-fg-subtle">Queue is empty</td></tr>
        )}
      </tbody>
    </table>
  );
}

// ── Section 5: Asset utilization ──────────────────────────────────────────────

function AssetUtilizationChart() {
  const { data, isLoading, isError } = useQuery<AssetUtilizationResponse>({
    queryKey: ['reports', 'assets'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/reports/assets/utilization');
      if (error || !data) throw new Error();
      return data;
    },
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <ChartSkeleton />;
  if (isError || !data) return <ErrorMsg />;

  const chartData = data.rows.map((r) => ({
    type: capitalize(r.type),
    assigned: r.assigned,
    inStock: r.inStock,
    retired: r.retired,
    pct: r.utilizationPct,
  }));

  if (!chartData.length) return <p className="py-4 text-center text-xs text-fg-subtle">No asset data</p>;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
        <XAxis dataKey="type" tick={{ fontSize: 10, fill: '#a1a1aa' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e4e4e7' }}
          formatter={(val, name) => name === 'pct' ? `${val}%` : val}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="assigned" name="Assigned" fill={BLUE} radius={[3, 3, 0, 0]} stackId="a" />
        <Bar dataKey="inStock" name="In Stock" fill={GREEN} radius={[3, 3, 0, 0]} stackId="a" />
        <Bar dataKey="retired" name="Retired" fill={ZINC} radius={[3, 3, 0, 0]} stackId="a" />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Section 6: Compliance findings donut ─────────────────────────────────────

function FindingsChart({ days }: { days: number }) {
  const { from, to } = dateRange(days);
  const { data, isLoading, isError } = useQuery<FindingsSummaryResponse>({
    queryKey: ['reports', 'findings', days],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/reports/compliance/findings', {
        params: { query: { from, to } },
      });
      if (error || !data) throw new Error();
      return data;
    },
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <ChartSkeleton />;
  if (isError || !data) return <ErrorMsg />;

  // Aggregate open findings by severity
  const pieData = data.rows
    .filter((r) => r.open > 0)
    .map((r) => ({ name: capitalize(r.severity), value: r.open, severity: r.severity }));

  if (!pieData.length) return (
    <div className="flex flex-col items-center justify-center h-48 gap-2">
      <p className="text-3xl">✅</p>
      <p className="text-sm text-fg-muted font-medium">No open findings</p>
    </div>
  );

  return (
    <div className="flex items-center gap-6">
      <ResponsiveContainer width={160} height={160}>
        <PieChart>
          <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
            {pieData.map((entry, i) => (
              <Cell key={i} fill={SEVERITY_COLORS[entry.severity] ?? ZINC} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e4e4e7' }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-col gap-2">
        {pieData.map((entry) => (
          <div key={entry.name} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: SEVERITY_COLORS[entry.severity] ?? ZINC }} />
            <span className="text-fg-muted">{entry.name}</span>
            <span className="ml-auto font-semibold tabular-nums text-fg">{entry.value}</span>
          </div>
        ))}
        <p className="mt-1 text-[10px] text-fg-subtle">open findings</p>
      </div>
    </div>
  );
}

// ── Section 7: Leave & Overtime summary ───────────────────────────────────────

function WorkforceSummary({ days }: { days: number }) {
  const { from, to } = dateRange(days);

  const leaveQ = useQuery<LeaveSummaryResponse>({
    queryKey: ['reports', 'leave', days],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/reports/workforce/leave', {
        params: { query: { from, to } },
      });
      if (error || !data) throw new Error();
      return data;
    },
    staleTime: 5 * 60_000,
  });

  const otQ = useQuery<OvertimeSummaryResponse>({
    queryKey: ['reports', 'overtime', days],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/reports/workforce/overtime', {
        params: { query: { from, to } },
      });
      if (error || !data) throw new Error();
      return data;
    },
    staleTime: 5 * 60_000,
  });

  const totalLeave = leaveQ.data?.rows.reduce((s, r) => s + r.count, 0) ?? 0;
  const totalOTHours = otQ.data?.rows.reduce((s, r) => s + r.totalHours, 0) ?? 0;
  const approvedOT = otQ.data?.rows.find((r) => r.status === 'approved');

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-lg bg-surface-muted p-3">
        <p className="text-xs text-fg-subtle">Leave requests</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-fg">{totalLeave}</p>
        <p className="mt-0.5 text-[10px] text-fg-subtle">this period</p>
      </div>
      <div className="rounded-lg bg-surface-muted p-3">
        <p className="text-xs text-fg-subtle">Overtime hours</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-fg">{Math.round(totalOTHours)}</p>
        <p className="mt-0.5 text-[10px] text-fg-subtle">total submitted</p>
      </div>
      <div className="rounded-lg bg-surface-muted p-3">
        <p className="text-xs text-fg-subtle">Approved OT hours</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-fg">{Math.round(approvedOT?.totalHours ?? 0)}</p>
        <p className="mt-0.5 text-[10px] text-fg-subtle">avg {Math.round(approvedOT?.avgHours ?? 0)}h / request</p>
      </div>
      <div className="rounded-lg bg-surface-muted p-3">
        <p className="text-xs text-fg-subtle">Approved OT requests</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-fg">{approvedOT?.count ?? 0}</p>
        <p className="mt-0.5 text-[10px] text-fg-subtle">approved this period</p>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ReportsPage() {
  const [days, setDays] = useState(30);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-fg">Reports</h1>
          <p className="mt-0.5 text-sm text-fg-muted">Analytics and KPIs across IT operations, compliance, and workforce.</p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="h-8 rounded-md border border-border bg-surface px-3 text-sm text-fg-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        >
          {DAYS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Row 1: Throughput (wide) + Queue depth */}
      <div className="grid grid-cols-3 gap-4">
        <Card title="Request Throughput" className="col-span-2">
          <ThroughputChart days={days} />
        </Card>
        <Card title="Live Queue Depth">
          <QueueTable />
        </Card>
      </div>

      {/* Row 2: SLA compliance + Cycle time */}
      <div className="grid grid-cols-2 gap-4">
        <Card title="SLA Compliance">
          <SlaChart days={days} />
        </Card>
        <Card title="Cycle Time (p50 / p90)">
          <CycleTimeChart days={days} />
        </Card>
      </div>

      {/* Row 3: Asset utilization + Findings donut */}
      <div className="grid grid-cols-2 gap-4">
        <Card title="Asset Utilization">
          <AssetUtilizationChart />
        </Card>
        <Card title="Open Compliance Findings">
          <FindingsChart days={days} />
        </Card>
      </div>

      {/* Row 4: Workforce */}
      <Card title="Workforce Summary">
        <WorkforceSummary days={days} />
      </Card>
    </div>
  );
}
