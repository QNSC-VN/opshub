import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, PackageSearch, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { DataTable, type DataTableColumn } from '@/shared/ui/data-table';
import { PaginationFooter } from '@/shared/ui/pagination-footer';
import { useListState } from '@/shared/hooks/use-list-state';
import { SlideOver, SlideOverSection } from '@/shared/ui/slide-over';
import { ActivityTimeline } from '@/shared/ui/activity-timeline';
import { UpgradeGate } from '@/shared/ui/upgrade-gate';
import { FEATURES } from '@/shared/config/features';
import type {
  FindingResponse,
  SoftwareListing,
  FindingSeverity,
  FindingStatus,
} from '@/shared/api/types';

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
  // Paged, where this tab previously asked for `limit: 100` and showed a total — which silently
  // truncated any catalogue with more entries than that.
  const list = useListState();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['compliance', 'software', list.offset, list.limit],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/compliance/software', {
        params: { query: { limit: list.limit, offset: list.offset } },
      });
      if (error || !data) throw new Error('Failed to load software catalog');
      return data;
    },
  });

  // The row type comes from the generated client rather than a hand-written interface, so a
  // response shape change is a type error here instead of an `undefined` on screen.
  type SoftwareRow = NonNullable<NonNullable<typeof data>['data']>[number];
  const columns: DataTableColumn<SoftwareRow>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (r) => <span className="font-medium text-fg">{r.name}</span>,
    },
    { key: 'publisher', header: 'Publisher', cell: (r) => r.publisher ?? '—' },
    {
      key: 'listing',
      header: 'Listing',
      cell: (r) => (
        <span
          className={[
            'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
            LISTING_CLASS[r.listing as SoftwareListing],
          ].join(' ')}
        >
          {LISTING_LABEL[r.listing as SoftwareListing]}
        </span>
      ),
    },
    {
      key: 'notes',
      header: 'Notes',
      cell: (r) => (
        <span className="text-xs text-fg-subtle" title={r.notes ?? ''}>
          {r.notes ?? '—'}
        </span>
      ),
      className: 'max-w-xs truncate',
      hideOnMobile: true,
    },
  ];

  return (
    <div className="space-y-3">
      <DataTable
        columns={columns}
        rows={data?.data}
        isLoading={isLoading}
        isError={isError}
        errorMessage="Failed to load software catalog."
        emptyMessage="No software entries found"
        emptyIcon={PackageSearch}
      />
      <PaginationFooter
        pageInfo={data?.pageInfo}
        onOffsetChange={list.goToOffset}
        noun="software"
      />
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
    if (error) {
      toast.error('Failed to resolve finding');
      return;
    }
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
          <button
            onClick={onClose}
            className="rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg-muted"
          >
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
            <span className="text-sm text-fg-muted">
              Accept residual risk (mark as risk accepted)
            </span>
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-md border border-border px-3.5 text-sm font-medium text-fg-muted hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
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

/**
 * The findings columns.
 *
 * A function rather than a constant because two of them need the row actions, and those close over
 * the tab's handlers. Declared outside the component so the array is not rebuilt per render.
 */
function findingColumns(actions: {
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
}): DataTableColumn<FindingResponse>[] {
  return [
    {
      key: 'software',
      header: 'Software',
      cell: (f) => <span className="font-medium text-fg">{f.softwareName}</span>,
    },
    {
      key: 'version',
      header: 'Version',
      cell: (f) => (
        <span className="font-mono text-xs text-fg-muted">{f.softwareVersion ?? '—'}</span>
      ),
      hideOnMobile: true,
    },
    {
      key: 'severity',
      header: 'Severity',
      cell: (f) => (
        <span
          className={[
            'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize',
            SEVERITY_CLASS[f.severity as FindingSeverity],
          ].join(' ')}
        >
          {f.severity}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (f) => (
        <span
          className={[
            'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
            FINDING_STATUS_CLASS[f.status as FindingStatus],
          ].join(' ')}
        >
          {FINDING_STATUS_LABEL[f.status as FindingStatus]}
        </span>
      ),
    },
    {
      key: 'detected',
      header: 'Detected',
      cell: (f) => (
        <span className="text-xs text-fg-subtle">
          {new Date(f.detectedAt).toLocaleDateString()}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: 'actions',
      header: 'Actions',
      // `stopPropagation` because the row itself opens the detail panel: without it, acknowledging
      // a finding would also open the panel for it.
      cell: (f) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {f.status === 'open' && (
            <button
              onClick={() => actions.onAcknowledge(f.id)}
              className="rounded px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent-muted"
            >
              Acknowledge
            </button>
          )}
          {(f.status === 'open' || f.status === 'acknowledged') && (
            <button
              onClick={() => actions.onResolve(f.id)}
              className="rounded px-2 py-1 text-xs font-medium text-success transition-colors hover:bg-success-bg"
            >
              Resolve
            </button>
          )}
        </div>
      ),
    },
  ];
}

function FindingsTab() {
  const qc = useQueryClient();
  const [severityFilter, setSeverityFilter] = useState<FindingSeverity | ''>('');
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<FindingResponse | null>(null);
  const list = useListState();

  const findings = useQuery({
    queryKey: ['compliance', 'findings', severityFilter, list.offset, list.limit],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/compliance/findings', {
        params: {
          query: {
            severity: (severityFilter || undefined) as never,
            limit: list.limit,
            offset: list.offset,
          },
        },
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
    if (error) {
      toast.error('Failed to acknowledge finding');
      return;
    }
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
              onClick={() => {
                setSeverityFilter(value);
                // Narrowing the set invalidates the offset: page 4 of the criticals may not exist.
                list.resetPaging();
              }}
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

        <DataTable
          columns={findingColumns({ onAcknowledge: handleAcknowledge, onResolve: setResolveId })}
          rows={findings.data?.data as FindingResponse[] | undefined}
          isLoading={findings.isLoading}
          isError={findings.isError}
          errorMessage="Failed to load findings."
          emptyMessage="No findings found"
          emptyIcon={ShieldAlert}
          onRowClick={(f) => setSelected(f)}
          isRowActive={(f) => f.id === selected?.id}
        />

        <PaginationFooter
          pageInfo={findings.data?.pageInfo}
          onOffsetChange={list.goToOffset}
          noun="findings"
        />
      </div>

      {/* Finding detail slide-over */}
      <SlideOver
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.softwareName ?? 'Finding detail'}
        description={selected ? `${selected.severity} · ${selected.status}` : undefined}
        width="lg"
        headerActions={
          selected && (selected.status === 'open' || selected.status === 'acknowledged') ? (
            <div className="flex items-center gap-2">
              {selected.status === 'open' && (
                <button
                  onClick={() => {
                    handleAcknowledge(selected.id);
                    setSelected(null);
                  }}
                  className="rounded-md bg-accent-muted px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-muted"
                >
                  Acknowledge
                </button>
              )}
              <button
                onClick={() => {
                  setResolveId(selected.id);
                  setSelected(null);
                }}
                className="rounded-md bg-success-bg px-3 py-1.5 text-xs font-medium text-success hover:bg-success-bg"
              >
                Resolve
              </button>
            </div>
          ) : undefined
        }
      >
        {selected && (
          <>
            <SlideOverSection title="Details">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {[
                  { label: 'Software', value: selected.softwareName },
                  { label: 'Version', value: selected.softwareVersion ?? '—' },
                  {
                    label: 'Severity',
                    value: (
                      <span
                        className={[
                          'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize',
                          SEVERITY_CLASS[selected.severity as FindingSeverity],
                        ].join(' ')}
                      >
                        {selected.severity}
                      </span>
                    ),
                  },
                  {
                    label: 'Status',
                    value: (
                      <span
                        className={[
                          'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
                          FINDING_STATUS_CLASS[selected.status as FindingStatus],
                        ].join(' ')}
                      >
                        {FINDING_STATUS_LABEL[selected.status as FindingStatus]}
                      </span>
                    ),
                  },
                  { label: 'Detected', value: new Date(selected.detectedAt).toLocaleDateString() },
                  {
                    label: 'Asset ID',
                    value: selected.assetId ? (
                      <span className="font-mono text-xs">{selected.assetId}</span>
                    ) : (
                      '—'
                    ),
                  },
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
                  <p className="font-mono text-xs text-danger">
                    {(selected as Record<string, unknown>).cveId as string}
                  </p>
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
