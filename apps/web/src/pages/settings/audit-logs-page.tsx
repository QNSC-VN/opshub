import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText, Search } from 'lucide-react';
import { api } from '@/shared/api/client';
import { POLL, STALE } from '@/shared/api/cache';
import {
  Badge,
  Button,
  DataTable,
  EntityDetailPanel,
  Input,
  ListPage,
  Select,
  SlideOverSection,
  humanizeStatus,
  type BadgeTone,
  type DataTableColumn,
} from '@/shared/ui';
import { useListState } from '@/shared/hooks/use-list-state';
import { formatDateTime, orDash } from '@/shared/lib/format';
import {
  AUDIT_RESOURCE_TYPES,
  type AuditLogResponse,
  type AuditResourceType,
} from '@/shared/api/types';

/*
 * WHAT THIS SCREEN NO LONGER CARRIES
 *
 * Its own `formatTs`, an `inputClass`, five raw header cells, a `dl` grid, and hand-rolled Previous /
 * Next buttons.
 *
 * The action badge's palette also held `bg-orange-50 text-orange-700` five times — a raw pair with no
 * dark variant, so those five verbs were unreadable on a dark background. Tones now.
 *
 * AND THE ACTOR FILTER DID NOTHING. The box collected an email, `applyFilters` committed it to state,
 * and the query never sent it — the API accepted `actorId`, a UUID, which is not what anybody
 * investigating an incident has. `actorEmail` is now a real API filter (case-insensitive substring,
 * added in this change with its own e2e test), so the box works.
 */

/**
 * Tone per action VERB — the last dotted segment of `audit_logs.action`.
 *
 * Past tense, because every code in `AUDIT_ACTION` is (`role.created`, not `role.create`). This was
 * present tense once, so not one of the 65 codes could match and every badge fell through to grey — a
 * dead colour scheme that no test and no glance would flag, since grey is a valid look.
 */
const VERB_TONE: Record<string, BadgeTone> = {
  created: 'green',
  added: 'green',
  approved: 'green',
  resolved: 'green',
  updated: 'blue',
  permissions_updated: 'blue',
  status_changed: 'blue',
  synced: 'blue',
  deleted: 'red',
  rejected: 'red',
  cancelled: 'red',
  assigned: 'violet',
  seat_assigned: 'violet',
  revoked: 'amber',
  seat_revoked: 'amber',
  unassigned: 'amber',
  retired: 'amber',
  disabled: 'amber',
};

function verbTone(action: string): BadgeTone {
  return VERB_TONE[action.split('.').pop() ?? action] ?? 'neutral';
}

export function AuditLogsPage() {
  // The three filters are COMMITTED on submit rather than per keystroke: this endpoint is rate-limited
  // `STRICT` (60/min) and a request per character would spend that in a sentence.
  /*
   * `resourceType` is TYPED, not free text.
   *
   * It used to be an `<Input>`, and the API accepted any string and answered an unknown one with an
   * empty list — so the filter's failure mode was "no results", indistinguishable from a resource with
   * no history. The API now validates it against the catalogue, which makes a typo a 422; the control
   * below is a `<Select>` so there is nothing to mistype. `leave` versus `leave_request` is exactly the
   * guess that made seven detail drawers render an empty timeline forever.
   */
  const [draft, setDraft] = useState<{
    actorEmail: string;
    resourceType: AuditResourceType | '';
    action: string;
  }>({ actorEmail: '', resourceType: '', action: '' });
  const [applied, setApplied] = useState(draft);
  const [selected, setSelected] = useState<AuditLogResponse | null>(null);
  const list = useListState(50);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit-logs', applied, list.offset, list.limit],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/audit-logs', {
        params: {
          query: {
            limit: list.limit,
            offset: list.offset,
            actorEmail: applied.actorEmail || undefined,
            resourceType: applied.resourceType || undefined,
            action: applied.action || undefined,
          },
        },
      });
      if (error || !data) throw new Error('Failed to load audit logs');
      return data;
    },
    staleTime: STALE.WATCHED,
    refetchInterval: POLL.WATCHED,
  });

  const columns: DataTableColumn<AuditLogResponse>[] = [
    {
      key: 'when',
      header: 'When',
      cell: (log) => (
        <span className="whitespace-nowrap text-xs tabular-nums text-fg-subtle">
          {formatDateTime(log.occurredAt)}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      cell: (log) => <Badge tone={verbTone(log.action)}>{log.action}</Badge>,
    },
    { key: 'resourceType', header: 'Resource', cell: (log) => log.resourceType },
    {
      key: 'resourceId',
      header: 'Resource ID',
      cell: (log) => <span className="font-mono text-xs">{orDash(log.resourceId)}</span>,
      className: 'max-w-[140px] truncate',
      hideOnMobile: true,
    },
    {
      key: 'actor',
      header: 'Actor',
      cell: (log) => log.actorEmail ?? log.actorId ?? 'system',
    },
  ];

  return (
    <>
      <ListPage
        title="Audit Logs"
        description="Every recorded action, who took it, and what it touched."
        filters={
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setApplied(draft);
              list.resetPaging();
            }}
          >
            <Input
              value={draft.actorEmail}
              onChange={(e) => setDraft((d) => ({ ...d, actorEmail: e.target.value }))}
              aria-label="Filter by actor email"
              placeholder="Actor email…"
              className="w-48"
            />
            <Select
              value={draft.resourceType}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  resourceType: e.target.value as AuditResourceType | '',
                }))
              }
              aria-label="Filter by resource type"
              className="w-44"
            >
              <option value="">Any resource</option>
              {AUDIT_RESOURCE_TYPES.map((value) => (
                <option key={value} value={value}>
                  {humanizeStatus(value)}
                </option>
              ))}
            </Select>
            <Input
              value={draft.action}
              onChange={(e) => setDraft((d) => ({ ...d, action: e.target.value }))}
              aria-label="Filter by action"
              placeholder="Action…"
              className="w-40"
            />
            <Button type="submit" variant="outline" size="sm">
              <Search className="h-3.5 w-3.5" /> Apply
            </Button>
          </form>
        }
        pageInfo={data?.pageInfo}
        onOffsetChange={list.goToOffset}
        noun="entries"
      >
        <DataTable
          columns={columns}
          rows={data?.data as AuditLogResponse[] | undefined}
          isLoading={isLoading}
          isError={isError}
          errorMessage="Failed to load audit logs."
          emptyMessage="No entries match these filters"
          emptyIcon={ScrollText}
          onRowClick={setSelected}
          isRowActive={(log) => log.id === selected?.id}
        />
      </ListPage>

      <EntityDetailPanel
        open={!!selected}
        onClose={() => setSelected(null)}
        width="lg"
        title={selected?.action ?? 'Audit entry'}
        description={selected ? formatDateTime(selected.occurredAt) : undefined}
        items={
          selected
            ? [
                {
                  label: 'Action',
                  value: <Badge tone={verbTone(selected.action)}>{selected.action}</Badge>,
                },
                { label: 'Resource type', value: selected.resourceType },
                {
                  label: 'Resource ID',
                  value: selected.resourceId ? (
                    <span className="font-mono text-xs">{selected.resourceId}</span>
                  ) : null,
                },
                { label: 'Actor', value: selected.actorEmail ?? selected.actorId ?? 'system' },
                { label: 'Time', value: formatDateTime(selected.occurredAt) },
              ]
            : []
        }
      >
        {selected && (
          <>
            {selected.changes && Object.keys(selected.changes).length > 0 && (
              <SlideOverSection title="Changes">
                <pre className="overflow-x-auto rounded-md border border-border bg-surface-muted p-3 text-xs text-fg-muted">
                  {JSON.stringify(selected.changes, null, 2)}
                </pre>
              </SlideOverSection>
            )}
            {selected.metadata && Object.keys(selected.metadata).length > 0 && (
              <SlideOverSection title="Metadata">
                <pre className="overflow-x-auto rounded-md border border-border bg-surface-muted p-3 text-xs text-fg-muted">
                  {JSON.stringify(selected.metadata, null, 2)}
                </pre>
              </SlideOverSection>
            )}
          </>
        )}
      </EntityDetailPanel>
    </>
  );
}
