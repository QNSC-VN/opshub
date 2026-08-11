import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, PackageSearch } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import {
  ActivityTimeline,
  DataTable,
  DescriptionList,
  PageHeader,
  PaginationFooter,
  SegmentedControl,
  SlideOver,
  SlideOverSection,
  StatusBadge,
  TabPanel,
  Tabs,
  UpgradeGate,
  humanizeStatus,
  statusTone,
  type DataTableColumn,
} from '@/shared/ui';
import { useListState } from '@/shared/hooks/use-list-state';
import { formatDate } from '@/shared/lib/format';
import { FEATURES } from '@/shared/config/features';
import { ResolveModal } from './compliance-modals';
import type { FindingResponse, SoftwareListing, FindingSeverity } from '@/shared/api/types';

/*
 * NO LOCAL COLOUR MAPS.
 *
 * This file used to carry four: `LISTING_CLASS`, `SEVERITY_CLASS`, `FINDING_STATUS_CLASS` and
 * `FINDING_STATUS_LABEL`. `high` severity was `bg-orange-50 text-orange-700` — a raw palette pair in a
 * codebase built on semantic tokens, so it did not flip in dark mode and was unreadable there. The
 * shared `statusTone` decides which tone a word means, `StatusBadge` decides what a tone looks like,
 * and `humanizeStatus` turns `risk_accepted` into `Risk accepted`.
 *
 * `listing` is the ONE vocabulary that stays local: whitelisted/blacklisted/unknown/review appears on
 * this screen alone, and a lookup nobody can attribute to a caller is worse than a local one.
 */
const LISTING_TONE = {
  whitelisted: 'green',
  blacklisted: 'red',
  review: 'amber',
  unknown: 'neutral',
} as const;

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
        <StatusBadge tone={LISTING_TONE[r.listing as SoftwareListing]}>
          {humanizeStatus(r.listing)}
        </StatusBadge>
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
        <StatusBadge tone={statusTone(f.severity)}>{humanizeStatus(f.severity)}</StatusBadge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (f) => (
        <StatusBadge tone={statusTone(f.status)}>{humanizeStatus(f.status)}</StatusBadge>
      ),
    },
    {
      key: 'detected',
      header: 'Detected',
      cell: (f) => <span className="text-xs text-fg-subtle">{formatDate(f.detectedAt)}</span>,
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
      toast.error(apiErrorMessage(error, 'Failed to acknowledge finding.'));
      return;
    }
    toast.success('Finding acknowledged');
    invalidate();
  }

  return (
    <>
      {/* Mounted only when there is an id, so the form resets between findings — `Modal` handles the
          open/closed transition and the focus restore. */}
      {resolveId && (
        <ResolveModal
          findingId={resolveId}
          open
          onClose={() => setResolveId(null)}
          onSuccess={invalidate}
        />
      )}

      <div className="flex flex-col gap-4">
        <SegmentedControl
          label="Filter by severity"
          options={SEVERITY_FILTERS}
          value={severityFilter}
          onChange={(value) => {
            setSeverityFilter(value);
            // Narrowing the set invalidates the offset: page 4 of the criticals may not exist.
            list.resetPaging();
          }}
        />

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
              <DescriptionList
                items={[
                  { label: 'Software', value: selected.softwareName },
                  { label: 'Version', value: selected.softwareVersion },
                  {
                    label: 'Severity',
                    value: (
                      <StatusBadge tone={statusTone(selected.severity)}>
                        {humanizeStatus(selected.severity)}
                      </StatusBadge>
                    ),
                  },
                  {
                    label: 'Status',
                    value: (
                      <StatusBadge tone={statusTone(selected.status)}>
                        {humanizeStatus(selected.status)}
                      </StatusBadge>
                    ),
                  },
                  { label: 'Detected', value: formatDate(selected.detectedAt) },
                  {
                    label: 'Asset ID',
                    value: selected.assetId ? (
                      <span className="font-mono text-xs">{selected.assetId}</span>
                    ) : null,
                  },
                  {
                    label: 'CVE',
                    value: (selected as Record<string, unknown>).cveId ? (
                      <span className="font-mono text-xs text-danger">
                        {(selected as Record<string, unknown>).cveId as string}
                      </span>
                    ) : null,
                  },
                ]}
              />
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

/**
 * The tabs.
 *
 * Declared as data rather than as three copies of a `<button>`, and rendered by the shared `Tabs` —
 * which is a real `role="tablist"` with arrow-key navigation and a roving tab index. The hand-rolled
 * bar this replaces had none of that: a screen reader announced three unrelated buttons and never
 * connected them to the content below.
 */
const COMPLIANCE_TABS: { value: ComplianceTab; label: string; badge?: React.ReactNode }[] = [
  { value: 'software', label: 'Software Catalog' },
  { value: 'findings', label: 'Findings' },
  {
    value: 'shadow-it',
    label: 'Shadow IT',
    badge: FEATURES.SHADOW_IT ? undefined : (
      <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
        Upgrade
      </span>
    ),
  },
];

export function CompliancePage() {
  const [tab, setTab] = useState<ComplianceTab>('software');

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Compliance"
        description="Software catalog, vulnerability findings, and remediation tracking."
      />

      <Tabs items={COMPLIANCE_TABS} value={tab} onChange={setTab} idPrefix="compliance" />

      {/* One panel at a time: mounting all three would fire every tab's query on load. */}
      <TabPanel idPrefix="compliance" value={tab}>
        {tab === 'software' && <SoftwareCatalogTab />}
        {tab === 'findings' && <FindingsTab />}
        {tab === 'shadow-it' && <ShadowItTab />}
      </TabPanel>
    </div>
  );
}
