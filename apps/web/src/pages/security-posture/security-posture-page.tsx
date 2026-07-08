import { useState } from 'react';
import { ENV } from '@/shared/config/env';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { getToken } from '@/shared/api/auth-store';
import { PageHeader } from '@/shared/ui/page-header';
import { UpgradeGate } from '@/shared/ui/upgrade-gate';
import { FEATURES } from '@/shared/config/features';
import { cn } from '@/shared/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScoreSnapshot {
  scoreDate: string;
  percentageScore: string;
}

interface BaselineCheck {
  id: string;
  category: string;
  checkName: string;
  status: string;
  expectedValue: string | null;
  actualValue: string | null;
  details: string | null;
}

interface BaselineSummary {
  pass: number;
  fail: number;
  warning: number;
  total: number;
}

interface ScoreLatest {
  score: string;
  maxScore: string;
  percentageScore: string;
  scoreDate: string;
}

// ── API helpers ───────────────────────────────────────────────────────────────

const headers = () => ({
  Authorization: `Bearer ${getToken() ?? ''}`,
  'Content-Type': 'application/json',
});

async function fetchSecureScore(): Promise<{ latest: ScoreLatest | null }> {
  const res = await fetch(`${ENV.API_BASE_URL}/v1/security-posture/score`, { headers: headers() });
  if (!res.ok) throw new Error('Failed to load score');
  return res.json() as Promise<{ latest: ScoreLatest | null }>;
}

async function fetchScoreHistory(days: number): Promise<{ history: ScoreSnapshot[] }> {
  const res = await fetch(`${ENV.API_BASE_URL}/v1/security-posture/score/history?days=${days}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error('Failed to load history');
  return res.json() as Promise<{ history: ScoreSnapshot[] }>;
}

async function fetchBaseline(): Promise<{
  checks: BaselineCheck[];
  summary: Record<string, BaselineSummary>;
}> {
  const res = await fetch(`${ENV.API_BASE_URL}/v1/security-posture/baseline`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error('Failed to load baseline');
  return res.json() as Promise<{
    checks: BaselineCheck[];
    summary: Record<string, BaselineSummary>;
  }>;
}

async function triggerSync(): Promise<void> {
  const res = await fetch(`${ENV.API_BASE_URL}/v1/security-posture/sync`, {
    method: 'POST',
    headers: headers(),
  });
  if (!res.ok) throw new Error('Sync failed');
}

// ── Sparkline SVG ─────────────────────────────────────────────────────────────

function Sparkline({ data }: { data: ScoreSnapshot[] }) {
  if (data.length < 2)
    return (
      <div className="flex h-full items-center justify-center text-xs text-fg-subtle">
        Syncing data…
      </div>
    );

  const W = 300;
  const H = 60;
  const PAD = 4;

  const vals = data.map((d) => parseFloat(d.percentageScore));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;

  const pts = vals.map((v, i) => {
    const x = PAD + (i / (vals.length - 1)) * (W - PAD * 2);
    const y = PAD + ((max - v) / range) * (H - PAD * 2);
    return `${x},${y}`;
  });

  const area = `M${pts.join('L')}L${W - PAD},${H - PAD}L${PAD},${H - PAD}Z`;
  const line = `M${pts.join('L')}`;

  const last = vals[vals.length - 1];
  const prev = vals[vals.length - 2];
  const trend = last > prev ? 'up' : last < prev ? 'down' : 'flat';
  const lastPt = pts[pts.length - 1].split(',');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={trend === 'up' ? '#22c55e' : '#ef4444'} stopOpacity="0.25" />
          <stop offset="100%" stopColor={trend === 'up' ? '#22c55e' : '#ef4444'} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark-fill)" />
      <path
        d={line}
        fill="none"
        stroke={trend === 'up' ? '#22c55e' : '#ef4444'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastPt[0]} cy={lastPt[1]} r="3" fill={trend === 'up' ? '#22c55e' : '#ef4444'} />
    </svg>
  );
}

// ── Score card ────────────────────────────────────────────────────────────────

function grade(pct: number): string {
  if (pct >= 80) return 'A';
  if (pct >= 65) return 'B';
  if (pct >= 50) return 'C';
  if (pct >= 35) return 'D';
  return 'F';
}

function gradeColor(g: string): string {
  const map: Record<string, string> = {
    A: 'text-emerald-600',
    B: 'text-green-600',
    C: 'text-amber-600',
    D: 'text-orange-600',
    F: 'text-red-600',
  };
  return map[g] ?? 'text-fg';
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === 'pass')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
        <CheckCircle className="h-3 w-3" /> Pass
      </span>
    );
  if (status === 'fail')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
        <XCircle className="h-3 w-3" /> Fail
      </span>
    );
  if (status === 'warning')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        <AlertTriangle className="h-3 w-3" /> Warning
      </span>
    );
  return <span className="text-xs text-fg-subtle">N/A</span>;
}

const CATEGORY_LABELS: Record<string, string> = {
  asr: 'Attack Surface Reduction',
  firewall: 'Firewall',
  encryption: 'Encryption',
  endpoint: 'Endpoint',
  identity: 'Identity',
  other: 'Other',
};

// ── Page ──────────────────────────────────────────────────────────────────────

export function SecurityPosturePage() {
  if (!FEATURES.SECURITY_POSTURE) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Security Posture"
          description="Microsoft Secure Score trends and baseline drift checks"
        />
        <UpgradeGate
          feature="Security Posture"
          requiredLicense="Microsoft 365 E3 / E5 or Microsoft Defender for Business"
          description="Secure Score monitoring and baseline drift checks require Microsoft Defender or an E3/E5 plan. Your current plan (Business Standard) does not include this capability."
          learnMoreHref="https://learn.microsoft.com/en-us/microsoft-365/security/defender/microsoft-secure-score"
        />
      </div>
    );
  }

  return <SecurityPostureContent />;
}

function SecurityPostureContent() {
  const qc = useQueryClient();
  const [showPassing, setShowPassing] = useState(false);

  const scoreQ = useQuery({ queryKey: ['security-posture', 'score'], queryFn: fetchSecureScore });
  const historyQ = useQuery({
    queryKey: ['security-posture', 'history', 30],
    queryFn: () => fetchScoreHistory(30),
  });
  const baselineQ = useQuery({
    queryKey: ['security-posture', 'baseline'],
    queryFn: fetchBaseline,
  });

  const syncMut = useMutation({
    mutationFn: triggerSync,
    onSuccess: () => {
      toast.success('Sync triggered — data will update shortly');
      void qc.invalidateQueries({ queryKey: ['security-posture'] });
    },
    onError: () => toast.error('Sync failed. Check Graph credentials.'),
  });

  const latest = scoreQ.data?.latest;
  const pct = latest ? parseFloat(latest.percentageScore) : null;
  const g = pct != null ? grade(pct) : null;
  const history = historyQ.data?.history ?? [];
  const summary = baselineQ.data?.summary ?? {};
  const checks = baselineQ.data?.checks ?? [];

  // Compute delta vs 7 days ago
  let delta: number | null = null;
  if (history.length >= 2) {
    const last = parseFloat(history[history.length - 1].percentageScore);
    const weekAgo = parseFloat(history[Math.max(0, history.length - 8)].percentageScore);
    delta = +(last - weekAgo).toFixed(1);
  }

  const categories = Object.keys(summary);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Security Posture"
        description="Microsoft Secure Score trends and baseline drift checks"
        actions={
          <button
            onClick={() => syncMut.mutate()}
            disabled={syncMut.isPending}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-medium text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', syncMut.isPending && 'animate-spin')} />
            Sync now
          </button>
        }
      />

      {/* ── Score summary ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Score tile */}
        <div className="col-span-1 flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-fg-subtle">
            <Shield className="h-3.5 w-3.5" />
            Secure Score
          </div>
          {scoreQ.isLoading ? (
            <div className="h-12 animate-pulse rounded-lg bg-surface-muted" />
          ) : latest ? (
            <div className="flex items-end gap-3">
              <span className="text-4xl font-bold tabular-nums text-fg">{Math.round(pct!)}%</span>
              {g && <span className={cn('mb-1 text-2xl font-bold', gradeColor(g))}>{g}</span>}
            </div>
          ) : (
            <p className="text-sm text-fg-muted">No data yet — run a sync to populate.</p>
          )}
          {latest && (
            <p className="text-xs text-fg-subtle">
              {latest.score} / {latest.maxScore} pts · {latest.scoreDate}
            </p>
          )}
          {delta != null && (
            <div
              className={cn(
                'flex items-center gap-1 text-sm font-medium',
                delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-600' : 'text-fg-muted',
              )}
            >
              {delta > 0 ? (
                <TrendingUp className="h-4 w-4" />
              ) : delta < 0 ? (
                <TrendingDown className="h-4 w-4" />
              ) : (
                <Minus className="h-4 w-4" />
              )}
              {delta > 0 ? '+' : ''}
              {delta}% vs 7 days ago
            </div>
          )}
        </div>

        {/* Sparkline */}
        <div className="col-span-2 flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">
            30-Day Trend
          </p>
          {historyQ.isLoading ? (
            <div className="h-16 animate-pulse rounded-lg bg-surface-muted" />
          ) : (
            <div className="h-16">
              <Sparkline data={history} />
            </div>
          )}
          {history.length > 0 && (
            <div className="flex justify-between text-xs text-fg-subtle">
              <span>{history[0].scoreDate}</span>
              <span>{history[history.length - 1].scoreDate}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Baseline summary ──────────────────────────────────────────────── */}
      {categories.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-fg">Baseline Checks by Category</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {categories.map((cat) => {
              const s = summary[cat];
              const passRate = s.total > 0 ? Math.round((s.pass / s.total) * 100) : 0;
              return (
                <div
                  key={cat}
                  className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4"
                >
                  <p className="text-xs font-medium text-fg-muted">{CATEGORY_LABELS[cat] ?? cat}</p>
                  <p
                    className={cn(
                      'text-2xl font-bold tabular-nums',
                      passRate >= 80
                        ? 'text-emerald-600'
                        : passRate >= 50
                          ? 'text-amber-600'
                          : 'text-red-600',
                    )}
                  >
                    {passRate}%
                  </p>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-surface-muted">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        passRate >= 80
                          ? 'bg-emerald-500'
                          : passRate >= 50
                            ? 'bg-amber-500'
                            : 'bg-red-500',
                      )}
                      style={{ width: `${passRate}%` }}
                    />
                  </div>
                  <p className="text-xs text-fg-subtle">
                    {s.pass}/{s.total} pass
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Baseline checks table ────────────────────────────────────────── */}
      {checks.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">Baseline Drift Details</h2>
            <div className="flex items-center gap-3">
              <span className="text-xs text-fg-subtle">
                {checks.filter((c) => c.status === 'fail').length} failing ·{' '}
                {checks.filter((c) => c.status === 'pass').length} passing
              </span>
              <button
                onClick={() => setShowPassing((p) => !p)}
                className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
              >
                {showPassing ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showPassing ? 'Hide passing' : 'Show passing'}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm" role="grid" aria-label="Baseline checks">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-left text-xs font-medium text-fg-subtle">
                  <th scope="col" className="px-4 py-3">
                    Category
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Check
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 text-right tabular-nums">
                    Score
                  </th>
                </tr>
              </thead>
              <tbody>
                {checks
                  .filter((c) =>
                    showPassing
                      ? c.status !== 'not_applicable'
                      : c.status !== 'pass' && c.status !== 'not_applicable',
                  )
                  .slice(0, 50)
                  .map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-border last:border-0 hover:bg-surface-muted/50"
                    >
                      <td className="px-4 py-3 text-xs text-fg-muted">
                        {CATEGORY_LABELS[c.category] ?? c.category}
                      </td>
                      <td className="px-4 py-3 text-fg">{c.checkName}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-fg-muted text-xs">
                        {c.actualValue ?? '—'} / {c.expectedValue ?? '—'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {checks.filter((c) => c.status !== 'pass' && c.status !== 'not_applicable').length ===
            0 && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900/30 dark:bg-emerald-950/20">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              <p className="text-sm text-emerald-700 dark:text-emerald-400">
                All baseline checks are passing.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Empty state when no data */}
      {!scoreQ.isLoading && !latest && (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-surface p-12 text-center">
          <ShieldAlert className="h-10 w-10 text-fg-subtle" />
          <div>
            <p className="font-medium text-fg">No security posture data yet</p>
            <p className="mt-1 text-sm text-fg-muted">
              Configure ENTRA_TENANT_ID, ENTRA_CLIENT_ID, and GRAPH_CLIENT_SECRET, then click Sync
              now.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
