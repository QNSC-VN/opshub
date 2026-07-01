import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, PackageSearch, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { SlideOver, SlideOverSection } from '@/shared/ui/slide-over';
import { ActivityTimeline } from '@/shared/ui/activity-timeline';
import { UpgradeGate } from '@/shared/ui/upgrade-gate';
import { FEATURES } from '@/shared/config/features';
import type { FindingResponse, SoftwareListing, FindingSeverity, FindingStatus } from '@/shared/api/types';

// ── Config ────────────────────────────────────────────────────────────────────

const LISTING_CLASS: Record<SoftwareListing, string> = {
  whitelisted: 'bg-success-bg text-success',
  blacklisted: 'bg-danger-bg text-danger',
  unknown: 'bg-surface-muted text-fg-muted',
  review: 'bg-warning-bg text-warning',
};

const LISTING_LABEL: Record<SoftwareListing, string> = {
  whitelisted: 'Whitelisted',
  blacklisted: 'Blacklisted',
  unknown: 'Unknown',
  review: 'Under review',
};

const SEVERITY_CLASS: Record<FindingSeverity, string> = {
  critical: 'bg-danger-bg text-danger',
  high: 'bg-orange-50 text-orange-700',
  medium: 'bg-warning-bg text-warning',
  low: 'bg-accent-muted text-accent',
};

const FINDING_STATUS_CLASS: Record<FindingStatus, string> = {
  open: 'bg-warning-bg text-warning',
  acknowledged: 'bg-accent-muted text-accent',
  resolved: 'bg-success-bg text-success',
  risk_accepted: 'bg-surface-muted text-fg-muted',
};

const FINDING_STATUS_LABEL: Record<FindingStatus, string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
  risk_accepted: 'Risk accepted',
};

// ── Software Catalog tab ──────────────────────────────────────────────────────

function SoftwareCatalogTab() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['compliance', 'software'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/compliance/software', {
        params: { query: { limit: 100 } },
      });
      if (error || !data) throw new Error('Failed to load software catalog');
      return data;
    },
  });

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-muted">
            <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Name</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Publisher</th>

            <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Listing</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {isLoading && (
            <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-fg-subtle">Loading…</td></tr>
          )}
          {isError && (
            <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-danger">Failed to load software catalog.</td></tr>
          )}
          {data?.data?.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-12 text-center">
                <div className="flex flex-col items-center gap-2">
                  <PackageSearch className="h-8 w-8 text-fg-subtle" strokeWidth={1.5} />
                  <span className="text-sm text-fg-subtle">No software entries found</span>
                </div>
              </td>
            </tr>
          )}
          {data?.data?.map((s) => (
            <tr key={s.id} className="transition-colors hover:bg-surface-hover">
              <td className="px-4 py-3 font-medium text-fg">{s.name}</td>
              <td className="px-4 py-3 text-fg-muted">{s.publisher ?? '—'}</td>

              <td className="px-4 py-3">
                <span className={['inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', LISTING_CLASS[s.listing as SoftwareListing]].join(' ')}>
                  {LISTING_LABEL[s.listing as SoftwareListing]}
                </span>
              </td>
              <td className="px-4 py-3 max-w-xs truncate text-xs text-fg-subtle" title={s.notes ?? ''}>
                {s.notes ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data?.pageInfo && (
        <div className="border-t border-border bg-surface-muted px-4 py-2.5 text-xs text-fg-subtle">
          {data.pageInfo.total} entr{data.pageInfo.total !== 1 ? 'ies' : 'y'}
        </div>
      )}
    </div>
  );
}

// ── Resolve modal ─────────────────────────────────────────────────────────────

interface ResolveModalProps {
  findingId: string;
  onClose: () => void;
  onSuccess: () => void;
}

function ResolveModal({ findingId, onClose, onSuccess }: ResolveModalProps) {
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState('');
  const [riskAccepted, setRiskAccepted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await api.POST('/v1/compliance/findings/{id}/resolve', {
      params: { path: { id: findingId } },
      body: { note: note || undefined, riskAccepted },
    });
    setLoading(false);
    if (error) { toast.error('Failed to resolve finding'); return; }
    toast.success(riskAccepted ? 'Finding marked as risk accepted' : 'Finding resolved');
    onSuccess();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-fg">Resolve finding</h2>
          <button onClick={onClose} className="rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Resolution note</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Describe how this finding was addressed…"
              className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={riskAccepted}
              onChange={(e) => setRiskAccepted(e.target.checked)}
              className="h-4 w-4 rounded border-border-strong text-accent focus:ring-accent"
            />
            <span className="text-sm text-fg-muted">Accept residual risk (mark as risk accepted)</span>
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button" onClick={onClose}
              className="h-8 rounded-md border border-border px-3.5 text-sm font-medium text-fg-muted hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="submit" disabled={loading}
              className="h-8 rounded-md bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {loading ? 'Saving…' : riskAccepted ? 'Accept risk' : 'Resolve'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Findings tab ──────────────────────────────────────────────────────────────

const SEVERITY_FILTERS = [
  { value: '' as const, label: 'All' },
  { value: 'critical' as const, label: 'Critical' },
  { value: 'high' as const, label: 'High' },
  { value: 'medium' as const, label: 'Medium' },
  { value: 'low' as const, label: 'Low' },
];

function FindingsTab() {
  const qc = useQueryClient();
  const [severityFilter, setSeverityFilter] = useState<FindingSeverity | ''>('');
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<FindingResponse | null>(null);

  const findings = useQuery({
    queryKey: ['compliance', 'findings', severityFilter],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/compliance/findings', {
        params: { query: { severity: (severityFilter || undefined) as never, limit: 100 } },
      });
      if (error || !data) throw new Error('Failed to load findings');
      return data;
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['compliance', 'findings'] });

  async function handleAcknowledge(id: string) {
    const { error } = await api.POST('/v1/compliance/findings/{id}/acknowledge', {
      params: { path: { id } },
    });
    if (error) { toast.error('Failed to acknowledge finding'); return; }
    toast.success('Finding acknowledged');
    invalidate();
  }

  return (
    <>
      {resolveId && (
        <ResolveModal
          findingId={resolveId}
          onClose={() => setResolveId(null)}
          onSuccess={invalidate}
        />
      )}

      <div className="flex flex-col gap-4">
        {/* Severity filter */}
        <div className="flex gap-1 rounded-lg bg-surface-muted p-1 w-fit">
          {SEVERITY_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setSeverityFilter(value)}
              className={[
                'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                severityFilter === value
                  ? 'bg-surface text-fg shadow-sm'
                  : 'text-fg-muted hover:text-fg-muted',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted">
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Software</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Version</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Severity</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Detected</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {findings.isLoading && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-fg-subtle">Loading…</td></tr>
              )}
              {findings.isError && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-danger">Failed to load findings.</td></tr>
              )}
              {findings.data?.data?.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <ShieldAlert className="h-8 w-8 text-fg-subtle" strokeWidth={1.5} />
                      <span className="text-sm text-fg-subtle">No findings found</span>
                    </div>
                  </td>
                </tr>
              )}
              {findings.data?.data?.map((f) => (
                <tr
                  key={f.id}
                  className="cursor-pointer transition-colors hover:bg-surface-hover"
                  onClick={() => setSelected(f as FindingResponse)}
                >
                  <td className="px-4 py-3 font-medium text-fg">{f.softwareName}</td>
                  <td className="px-4 py-3 font-mono text-xs text-fg-muted">{f.softwareVersion ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={['inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize', SEVERITY_CLASS[f.severity as FindingSeverity]].join(' ')}>
                      {f.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={['inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', FINDING_STATUS_CLASS[f.status as FindingStatus]].join(' ')}>
                      {FINDING_STATUS_LABEL[f.status as FindingStatus]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-fg-subtle">{new Date(f.detectedAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      {f.status === 'open' && (
                        <button
                          onClick={() => handleAcknowledge(f.id)}
                          className="rounded px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent-muted"
                        >
                          Acknowledge
                        </button>
                      )}
                      {(f.status === 'open' || f.status === 'acknowledged') && (
                        <button
                          onClick={() => setResolveId(f.id)}
                          className="rounded px-2 py-1 text-xs font-medium text-success transition-colors hover:bg-success-bg"
                        >
                          Resolve
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {findings.data?.pageInfo && (
            <div className="border-t border-border bg-surface-muted px-4 py-2.5 text-xs text-fg-subtle">
              {findings.data.pageInfo.total} finding{findings.data.pageInfo.total !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      </div>

      {/* Finding detail slide-over */}
      <SlideOver
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.softwareName ?? 'Finding detail'}
        description={selected ? `${selected.severity} · ${selected.status}` : undefined}
        width="lg"
        headerActions={selected && (selected.status === 'open' || selected.status === 'acknowledged') ? (
          <div className="flex items-center gap-2">
            {selected.status === 'open' && (
              <button
                onClick={() => { handleAcknowledge(selected.id); setSelected(null); }}
                className="rounded-md bg-accent-muted px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-muted"
              >
                Acknowledge
              </button>
            )}
            <button
              onClick={() => { setResolveId(selected.id); setSelected(null); }}
              className="rounded-md bg-success-bg px-3 py-1.5 text-xs font-medium text-success hover:bg-success-bg"
            >
              Resolve
            </button>
          </div>
        ) : undefined}
      >
        {selected && (
          <>
            <SlideOverSection title="Details">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {[
                  { label: 'Software',  value: selected.softwareName },
                  { label: 'Version',   value: selected.softwareVersion ?? '—' },
                  { label: 'Severity',  value: <span className={['inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize', SEVERITY_CLASS[selected.severity as FindingSeverity]].join(' ')}>{selected.severity}</span> },
                  { label: 'Status',    value: <span className={['inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', FINDING_STATUS_CLASS[selected.status as FindingStatus]].join(' ')}>{FINDING_STATUS_LABEL[selected.status as FindingStatus]}</span> },
                  { label: 'Detected',  value: new Date(selected.detectedAt).toLocaleDateString() },
                  { label: 'Asset ID',  value: selected.assetId ? <span className="font-mono text-xs">{selected.assetId}</span> : '—' },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <dt className="text-xs text-fg-subtle">{label}</dt>
                    <dd className="mt-0.5 text-fg">{value}</dd>
                  </div>
                ))}
              </dl>
              {!!(selected as Record<string, unknown>).cveId && (
                <div className="mt-4 rounded-md bg-danger-bg px-3 py-2.5 text-sm">
                  <p className="text-xs text-red-400">CVE</p>
                  <p className="font-mono text-xs text-danger">{(selected as Record<string, unknown>).cveId as string}</p>
                </div>
              )}
            </SlideOverSection>

            <div className="mx-5 h-px bg-surface-muted" />

            <SlideOverSection title="Activity">
              <ActivityTimeline resourceId={selected.id} resourceType="finding" />
            </SlideOverSection>
          </>
        )}
      </SlideOver>
    </>
  );
}

function ShadowItTab() {
  return (
    <UpgradeGate
      feature="Shadow IT Detection"
      requiredLicense="Microsoft Intune / Endpoint Manager"
      description="Shadow IT detection scans managed devices for non-whitelisted software using Microsoft Intune's device inventory. Your current plan (Business Standard) does not include Intune — upgrade to Business Premium or add an Intune add-on."
      learnMoreHref="https://learn.microsoft.com/en-us/mem/intune/fundamentals/what-is-intune"
    />
  );
}

type ComplianceTab = 'software' | 'findings' | 'shadow-it';

export function CompliancePage() {
  const [tab, setTab] = useState<ComplianceTab>('software');

  const TABS: Array<[ComplianceTab, string, boolean?]> = [
    ['software', 'Software Catalog'],
    ['findings', 'Findings'],
    ['shadow-it', 'Shadow IT'],
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-fg">Compliance</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          Software catalog, vulnerability findings, and remediation tracking.
        </p>
      </div>

      {/* Tab bar */}
      <div className="border-b border-border">
        <nav className="-mb-px flex gap-6">
          {TABS.map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={[
                'inline-flex items-center gap-1.5 pb-3 text-sm font-medium transition-colors',
                tab === value
                  ? 'border-b-2 border-blue-600 text-accent'
                  : 'border-b-2 border-transparent text-fg-muted hover:text-fg-muted',
              ].join(' ')}
            >
              {label}
              {value === 'shadow-it' && !FEATURES.SHADOW_IT && (
                <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-surface-muted text-fg-muted">
                  Upgrade
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'software' && <SoftwareCatalogTab />}
      {tab === 'findings' && <FindingsTab />}
      {tab === 'shadow-it' && <ShadowItTab />}
    </div>
  );
}
