/**
 * The REQUEST reports — everything under `/v1/reports/requests/*`.
 *
 * Split from a single `report-charts.tsx` that held all seven panels and sat exactly AT the 486-line
 * ratchet ceiling, which meant no change to any report could land until it was decomposed. The seam is the
 * API's own report families rather than a made-up grouping, so a new endpoint has an obvious home: request
 * reports here, asset reports next door, and so on.
 *
 *  - throughput   — daily submitted vs resolved (area)
 *  - SLA          — per-type compliance rate (bar)
 *  - cycle time   — p50 / p90 hours per type (bar)
 *  - queue depth  — current pending / in-review (table)
 */
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { api } from '@/shared/api/client';
import type {
  ThroughputResponse,
  SlaComplianceResponse,
  CycleTimeResponse,
  QueueDepthResponse,
} from '@/shared/api/types';
import { ChartSkeleton, ErrorMsg } from './report-parts';
import { BLUE, GREEN, RED, VIOLET, capitalize, dateRange, shortDay } from './report-config';

export function ThroughputChart({ days }: { days: number }) {
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
        <XAxis
          dataKey="day"
          tick={{ fontSize: 10, fill: '#a1a1aa' }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#a1a1aa' }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e4e4e7' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Area
          type="monotone"
          dataKey="submitted"
          name="Submitted"
          stroke={BLUE}
          fill="url(#gradSubmitted)"
          strokeWidth={2}
          dot={false}
        />
        <Area
          type="monotone"
          dataKey="resolved"
          name="Resolved"
          stroke={GREEN}
          fill="url(#gradResolved)"
          strokeWidth={2}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── SLA compliance ────────────────────────────────────────────────────────────

export function SlaChart({ days }: { days: number }) {
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
    Breached: r.breached,
    Rate: r.complianceRatePct ?? 0,
  }));

  if (!chartData.length)
    return <p className="py-4 text-center text-xs text-fg-subtle">No SLA data for this period</p>;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
        <XAxis
          dataKey="type"
          tick={{ fontSize: 10, fill: '#a1a1aa' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#a1a1aa' }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e4e4e7' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="Within SLA" fill={GREEN} radius={[3, 3, 0, 0]} />
        <Bar dataKey="Breached" fill={RED} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Cycle time ────────────────────────────────────────────────────────────────

export function CycleTimeChart({ days }: { days: number }) {
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

  if (!chartData.length)
    return (
      <p className="py-4 text-center text-xs text-fg-subtle">No cycle time data for this period</p>
    );

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
        <XAxis
          dataKey="type"
          tick={{ fontSize: 10, fill: '#a1a1aa' }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#a1a1aa' }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e4e4e7' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="p50 (h)" fill={BLUE} radius={[3, 3, 0, 0]} />
        <Bar dataKey="p90 (h)" fill={VIOLET} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Queue depth ───────────────────────────────────────────────────────────────

export function QueueTable() {
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
            <td
              className={`py-2 text-right tabular-nums font-medium ${r.atRisk > 0 ? 'text-warning' : 'text-fg-subtle'}`}
            >
              {r.atRisk}
            </td>
            <td className="py-2 text-right tabular-nums font-semibold text-fg">{r.total}</td>
          </tr>
        ))}
        {data.rows.length === 0 && (
          <tr>
            <td colSpan={5} className="py-4 text-center text-fg-subtle">
              Queue is empty
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
