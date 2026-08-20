/**
 * The COMPLIANCE reports — `/v1/reports/compliance/*`.
 *
 * The donut is deliberately not a stacked bar: open findings by severity is a part-of-whole with four
 * slices, and severity already owns its colours in `SEVERITY_COLORS`.
 */
import { useQuery } from '@tanstack/react-query';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '@/shared/api/client';
import { STALE } from '@/shared/api/cache';
import type { FindingsSummaryResponse } from '@/shared/api/types';
import { ChartSkeleton, ErrorMsg } from './report-parts';
import { SEVERITY_COLORS, ZINC, capitalize, dateRange } from './report-config';

export function FindingsChart({ days }: { days: number }) {
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
    staleTime: STALE.REPORT,
  });

  if (isLoading) return <ChartSkeleton />;
  if (isError || !data) return <ErrorMsg />;

  // Aggregate open findings by severity
  const pieData = data.rows
    .filter((r) => r.open > 0)
    .map((r) => ({ name: capitalize(r.severity), value: r.open, severity: r.severity }));

  if (!pieData.length)
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2">
        <p className="text-3xl">✅</p>
        <p className="text-sm text-fg-muted font-medium">No open findings</p>
      </div>
    );

  return (
    <div className="flex items-center gap-6">
      <ResponsiveContainer width={160} height={160}>
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            innerRadius={45}
            outerRadius={70}
            paddingAngle={3}
            dataKey="value"
          >
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
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ background: SEVERITY_COLORS[entry.severity] ?? ZINC }}
            />
            <span className="text-fg-muted">{entry.name}</span>
            <span className="ml-auto font-semibold tabular-nums text-fg">{entry.value}</span>
          </div>
        ))}
        <p className="mt-1 text-2xs text-fg-subtle">open findings</p>
      </div>
    </div>
  );
}
