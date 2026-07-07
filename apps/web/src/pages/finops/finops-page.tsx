import { useState } from 'react';
import { ENV } from '@/shared/config/env';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  X,
  AlertTriangle,
  DollarSign,
  Package,
  Users,
  PackageOpen,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { getToken } from '@/shared/api/auth-store';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const PAGE_SIZE = 50;

// ── Inline types (until openapi-typescript regenerated) ─────────────────────

interface SoftwareLicense {
  id: string;
  name: string;
  vendor: string;
  licenseType: 'perpetual' | 'subscription' | 'per_seat' | 'concurrent';
  seatCount: number | null;
  costPerSeatCents: number | null;
  renewalDate: string | null;
  status: 'active' | 'expiring_soon' | 'expired' | 'cancelled';
  notes: string | null;
  externalId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface LicenseUtilization {
  licenseId: string;
  name: string;
  vendor: string;
  seatCount: number | null;
  usedSeats: number;
  availableSeats: number | null;
  utilizationPct: number | null;
  monthlySpendCents: number | null;
}

interface PagedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

// ── Colour helpers ───────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-success-bg text-success',
  expiring_soon: 'bg-warning-bg text-warning',
  expired: 'bg-danger-bg text-danger',
  cancelled: 'bg-surface-muted text-fg-muted',
};

const LICENSE_TYPE_LABEL: Record<string, string> = {
  perpetual: 'Perpetual',
  subscription: 'Subscription',
  per_seat: 'Per seat',
  concurrent: 'Concurrent',
};

const CHART_COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];

function centsToDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function daysUntilRenewal(renewalDate: string): number {
  const diff = new Date(renewalDate).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// ── Hooks ────────────────────────────────────────────────────────────────────

function useLicenses(search: string, page: number) {
  const offset = page * PAGE_SIZE;
  return useQuery({
    queryKey: ['licenses', 'list', search, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        ...(search ? { search } : {}),
      });
      const res = await fetch(`${ENV.API_BASE_URL}/v1/licenses?${params.toString()}`, {
        headers: { Authorization: `Bearer ${getToken() ?? ''}` },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'Failed to load licenses');
      }
      return res.json() as Promise<PagedResult<SoftwareLicense>>;
    },
    placeholderData: (prev) => prev,
  });
}

function useUtilization() {
  return useQuery({
    queryKey: ['licenses', 'utilization'],
    queryFn: async () => {
      const res = await fetch(`${ENV.API_BASE_URL}/v1/licenses/utilization`, {
        headers: {
          Authorization: `Bearer ${getToken() ?? ''}`,
        },
      });
      if (!res.ok) throw new Error('Failed to load utilization');
      return res.json() as Promise<LicenseUtilization[]>;
    },
  });
}

// ── Add License Modal ────────────────────────────────────────────────────────

interface AddLicenseModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function AddLicenseModal({ onClose, onSuccess }: AddLicenseModalProps) {
  const [form, setForm] = useState({
    name: '',
    vendor: '',
    licenseType: 'subscription' as SoftwareLicense['licenseType'],
    seatCount: '',
    costPerSeatCents: '',
    renewalDate: '',
    notes: '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const token = getToken() ?? '';
      const res = await fetch(`${ENV.API_BASE_URL}/v1/licenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: form.name,
          vendor: form.vendor,
          licenseType: form.licenseType,
          seatCount: form.seatCount ? Number(form.seatCount) : null,
          costPerSeatCents: form.costPerSeatCents
            ? Math.round(Number(form.costPerSeatCents) * 100)
            : null,
          renewalDate: form.renewalDate || null,
          notes: form.notes || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'Failed to create license');
      }
    },
    onSuccess: () => {
      onSuccess();
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const inputClass =
    'h-8 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-fg">Add license</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 p-5">
          {error && <p className="text-xs text-danger">{error}</p>}

          <div>
            <label className="mb-1 block text-xs font-medium text-fg-subtle">Product name *</label>
            <input
              className={inputClass}
              placeholder="Microsoft 365 Business Premium"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-fg-subtle">Vendor *</label>
            <input
              className={inputClass}
              placeholder="Microsoft"
              value={form.vendor}
              onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-subtle">Type</label>
              <select
                className={inputClass}
                value={form.licenseType}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    licenseType: e.target.value as SoftwareLicense['licenseType'],
                  }))
                }
              >
                <option value="subscription">Subscription</option>
                <option value="per_seat">Per seat</option>
                <option value="perpetual">Perpetual</option>
                <option value="concurrent">Concurrent</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-subtle">
                Seats (blank = unlimited)
              </label>
              <input
                type="number"
                min={1}
                className={inputClass}
                placeholder="100"
                value={form.seatCount}
                onChange={(e) => setForm((f) => ({ ...f, seatCount: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-subtle">
                Cost/seat/month (USD)
              </label>
              <input
                type="number"
                min={0}
                step={0.01}
                className={inputClass}
                placeholder="12.50"
                value={form.costPerSeatCents}
                onChange={(e) => setForm((f) => ({ ...f, costPerSeatCents: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-subtle">Renewal date</label>
              <input
                type="date"
                className={inputClass}
                value={form.renewalDate}
                onChange={(e) => setForm((f) => ({ ...f, renewalDate: e.target.value }))}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-fg-subtle">Notes</label>
            <textarea
              rows={2}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 resize-none"
              placeholder="Optional notes…"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-fg-subtle hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            disabled={!form.name || !form.vendor || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {mutation.isPending ? 'Saving…' : 'Add license'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Stat tile ────────────────────────────────────────────────────────────────

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <div className={`rounded-lg p-2 ${color}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-fg-subtle">{label}</p>
          <p className="mt-0.5 text-xl font-semibold text-fg">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-fg-muted">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function FinOpsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [showAdd, setShowAdd] = useState(false);

  const { data: licensePage, isLoading: licensesLoading, isFetching } = useLicenses(search, page);
  const { data: utilization, isLoading: utilLoading } = useUtilization();

  const licenses = licensePage?.data ?? [];
  const total = licensePage?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const util = utilization ?? [];

  // Aggregate stats
  const totalMonthlySpend = util.reduce((s, r) => s + (r.monthlySpendCents ?? 0), 0);
  const totalAssigned = util.reduce((s, r) => s + r.usedSeats, 0);
  const totalSeats = util.reduce((s, r) => s + (r.seatCount ?? 0), 0);
  const expiringCount = licenses.filter((l) => {
    if (!l.renewalDate) return false;
    return daysUntilRenewal(l.renewalDate) <= 30 && l.status !== 'expired';
  }).length;

  // Top 6 for pie chart
  const pieData = util
    .filter((r) => r.monthlySpendCents != null && r.monthlySpendCents > 0)
    .sort((a, b) => (b.monthlySpendCents ?? 0) - (a.monthlySpendCents ?? 0))
    .slice(0, 6)
    .map((r) => ({ name: r.name, value: r.monthlySpendCents! }));

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="sticky top-0 z-10 border-b border-border bg-app px-6 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-fg">Software &amp; License FinOps</h1>
            <p className="text-xs text-fg-subtle">
              Seat utilization · renewals · cost optimization
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
          >
            <Plus className="h-4 w-4" />
            Add license
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Stat tiles */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatTile
            icon={DollarSign}
            label="Monthly spend"
            value={centsToDollars(totalMonthlySpend)}
            sub="across active seats"
            color="bg-accent/10 text-accent"
          />
          <StatTile
            icon={Package}
            label="Licenses"
            value={String(total)}
            sub={`${util.filter((r) => r.seatCount != null).length} metered`}
            color="bg-violet-500/10 text-violet-600"
          />
          <StatTile
            icon={Users}
            label="Assigned seats"
            value={`${totalAssigned} / ${totalSeats}`}
            sub="across all licenses"
            color="bg-emerald-500/10 text-emerald-600"
          />
          <StatTile
            icon={AlertTriangle}
            label="Renewing soon"
            value={String(expiringCount)}
            sub="within 30 days"
            color={
              expiringCount > 0 ? 'bg-warning-bg text-warning' : 'bg-surface-muted text-fg-muted'
            }
          />
        </div>

        {/* Charts + utilization */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Spend pie */}
          <div className="rounded-xl border border-border bg-surface p-5">
            <h2 className="mb-3 text-sm font-semibold text-fg">Monthly spend by product</h2>
            {pieData.length === 0 ? (
              <p className="text-xs text-fg-muted">No cost data yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ name, percent }) => `${name} ${Math.round((percent ?? 0) * 100)}%`}
                    labelLine={false}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => centsToDollars(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Seat utilization bars */}
          <div className="col-span-2 rounded-xl border border-border bg-surface p-5">
            <h2 className="mb-3 text-sm font-semibold text-fg">Seat utilization</h2>
            {utilLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i}>
                    <div className="mb-1.5 flex justify-between">
                      <div className="h-3 w-32 animate-pulse rounded bg-surface-muted" />
                      <div className="h-3 w-16 animate-pulse rounded bg-surface-muted" />
                    </div>
                    <div className="h-2 w-full animate-pulse rounded-full bg-surface-muted" />
                  </div>
                ))}
              </div>
            ) : util.length === 0 ? (
              <p className="text-xs text-fg-muted">No data yet.</p>
            ) : (
              <div className="space-y-3">
                {util
                  .filter((r) => r.seatCount != null)
                  .sort((a, b) => (b.utilizationPct ?? 0) - (a.utilizationPct ?? 0))
                  .slice(0, 8)
                  .map((r) => {
                    const pct = r.utilizationPct ?? 0;
                    const barColor =
                      pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-accent';
                    return (
                      <div key={r.licenseId}>
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-xs font-medium text-fg truncate max-w-[60%]">
                            {r.name}
                          </span>
                          <span className="text-xs text-fg-subtle">
                            {r.usedSeats} / {r.seatCount} ({pct}%)
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-border">
                          <div
                            className={`h-2 rounded-full transition-all ${barColor}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>

        {/* License catalog table */}
        <div className="rounded-xl border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-fg">License catalog</h2>
              {!licensesLoading && total > 0 && (
                <span className="text-xs text-fg-muted">
                  {total} license{total !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <input
              className="h-7 w-48 rounded-md border border-border bg-surface-hover px-2 text-xs text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
              placeholder="Search…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>

          {licensesLoading ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-hover text-left text-xs text-fg-subtle">
                    <th className="px-5 py-2 font-medium" scope="col">
                      Product
                    </th>
                    <th className="px-4 py-2 font-medium" scope="col">
                      Vendor
                    </th>
                    <th className="px-4 py-2 font-medium" scope="col">
                      Type
                    </th>
                    <th className="px-4 py-2 font-medium" scope="col">
                      Seats used
                    </th>
                    <th className="px-4 py-2 font-medium" scope="col">
                      Cost/seat/mo
                    </th>
                    <th className="px-4 py-2 font-medium" scope="col">
                      Monthly total
                    </th>
                    <th className="px-4 py-2 font-medium" scope="col">
                      Renewal
                    </th>
                    <th className="px-4 py-2 font-medium" scope="col">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="px-5 py-3">
                        <div className="h-3.5 w-32 animate-pulse rounded bg-surface-muted" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-3.5 w-20 animate-pulse rounded bg-surface-muted" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-3.5 w-16 animate-pulse rounded bg-surface-muted" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-3.5 w-14 animate-pulse rounded bg-surface-muted" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-3.5 w-14 animate-pulse rounded bg-surface-muted" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-3.5 w-14 animate-pulse rounded bg-surface-muted" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-3.5 w-20 animate-pulse rounded bg-surface-muted" />
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-5 w-16 animate-pulse rounded-full bg-surface-muted" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : licenses.length === 0 ? (
            <div className="flex flex-col items-center py-12">
              <PackageOpen className="h-10 w-10 text-fg-subtle" strokeWidth={1.25} />
              <p className="mt-3 text-sm font-medium text-fg">
                {search ? 'No licenses match your search' : 'No licenses yet'}
              </p>
              <p className="mt-1 text-xs text-fg-muted">
                {search
                  ? 'Try a different product or vendor name.'
                  : 'Add your first software license to start tracking seats and costs.'}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto" aria-label="License catalog" role="region">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-hover text-left text-xs text-fg-subtle">
                      <th className="px-5 py-2 font-medium" scope="col">
                        Product
                      </th>
                      <th className="px-4 py-2 font-medium" scope="col">
                        Vendor
                      </th>
                      <th className="px-4 py-2 font-medium" scope="col">
                        Type
                      </th>
                      <th className="px-4 py-2 font-medium" scope="col">
                        Seats used
                      </th>
                      <th className="px-4 py-2 font-medium" scope="col">
                        Cost/seat/mo
                      </th>
                      <th className="px-4 py-2 font-medium" scope="col">
                        Monthly total
                      </th>
                      <th className="px-4 py-2 font-medium" scope="col">
                        Renewal
                      </th>
                      <th className="px-4 py-2 font-medium" scope="col">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className={isFetching ? 'opacity-60' : ''}>
                    {licenses.map((l) => {
                      const u = util.find((r) => r.licenseId === l.id);
                      const used = u?.usedSeats ?? 0;
                      const monthlyTotal = u?.monthlySpendCents ?? null;
                      const days = l.renewalDate ? daysUntilRenewal(l.renewalDate) : null;
                      return (
                        <tr
                          key={l.id}
                          className="border-b border-border/50 hover:bg-surface-hover/50"
                        >
                          <td className="px-5 py-3 font-medium text-fg">{l.name}</td>
                          <td className="px-4 py-3 text-fg-subtle">{l.vendor}</td>
                          <td className="px-4 py-3 text-fg-subtle">
                            {LICENSE_TYPE_LABEL[l.licenseType]}
                          </td>
                          <td className="px-4 py-3 text-fg-subtle">
                            {l.seatCount != null
                              ? `${used} / ${l.seatCount}`
                              : `${used} (unlimited)`}
                          </td>
                          <td className="px-4 py-3 text-fg-subtle">
                            {l.costPerSeatCents != null ? centsToDollars(l.costPerSeatCents) : '—'}
                          </td>
                          <td className="px-4 py-3 text-fg-subtle">
                            {monthlyTotal != null ? centsToDollars(monthlyTotal) : '—'}
                          </td>
                          <td className="px-4 py-3 text-fg-subtle">
                            {l.renewalDate ? (
                              <span
                                className={
                                  days != null && days <= 30 ? 'text-warning font-medium' : ''
                                }
                              >
                                {l.renewalDate}
                                {days != null && days <= 30 && days > 0 && ` (${days}d)`}
                                {days != null && days <= 0 && ' (overdue)'}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[l.status] ?? ''}`}
                            >
                              {l.status.replace('_', ' ')}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination footer */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-border px-5 py-3">
                  <p className="text-xs text-fg-muted">
                    Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of{' '}
                    {total}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      disabled={page === 0}
                      onClick={() => setPage((p) => p - 1)}
                      aria-label="Previous page"
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-fg-muted hover:bg-surface-hover disabled:opacity-40"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="px-2 text-xs text-fg-muted">
                      {page + 1} / {totalPages}
                    </span>
                    <button
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage((p) => p + 1)}
                      aria-label="Next page"
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-fg-muted hover:bg-surface-hover disabled:opacity-40"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showAdd && (
        <AddLicenseModal
          onClose={() => setShowAdd(false)}
          onSuccess={() => {
            void qc.invalidateQueries({ queryKey: ['licenses'] });
          }}
        />
      )}
    </div>
  );
}
