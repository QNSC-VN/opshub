/**
 * AuditLogsPage — filterable audit trail for it-admin / security roles.
 *
 * Features:
 *  - Filter by actor email, resource type, action keyword
 *  - Offset-paginated table (50 per page)
 *  - Expandable row showing changes + metadata JSON
 *  - Auto-refresh every 30 s
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ShieldAlert } from 'lucide-react';
import { api } from '@/shared/api/client';
import { SlideOver, SlideOverSection } from '@/shared/ui/slide-over';
import type { AuditLogResponse } from '@/shared/api/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTs(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const ACTION_CLASS: Record<string, string> = {
  create: 'bg-success-bg text-success',
  update: 'bg-accent-muted text-accent',
  delete: 'bg-danger-bg text-danger',
  approve: 'bg-success-bg text-success',
  reject: 'bg-danger-bg text-danger',
  assign: 'bg-violet-bg text-violet-fg',
  revoke: 'bg-orange-50 text-orange-700',
};

function actionClass(action: string): string {
  const verb = action.split('.').pop() ?? action;
  return ACTION_CLASS[verb] ?? 'bg-surface-muted text-fg-muted';
}

const inputClass =
  'h-8 rounded-md border border-border bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

// ── Row ───────────────────────────────────────────────────────────────────────

function AuditRow({ log, onSelect }: { log: AuditLogResponse; onSelect: (l: AuditLogResponse) => void }) {
  return (
    <tr
      className="border-b border-border cursor-pointer transition-colors hover:bg-surface-hover"
      onClick={() => onSelect(log)}
    >
      <td className="px-4 py-2.5 text-xs text-fg-subtle tabular-nums">{formatTs(log.occurredAt)}</td>
      <td className="px-4 py-2.5">
        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${actionClass(log.action)}`}>
          {log.action}
        </span>
      </td>
      <td className="px-4 py-2.5 text-xs text-fg-muted">{log.resourceType}</td>
      <td className="px-4 py-2.5 text-xs font-mono text-fg-muted truncate max-w-[120px]">
        {log.resourceId ?? '—'}
      </td>
      <td className="px-4 py-2.5 text-xs text-fg-muted">
        {log.actorEmail ?? log.actorId ?? 'system'}
      </td>
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

interface AuditListResponse {
  data?: AuditLogResponse[];
  pageInfo?: { total: number; limit: number; offset: number; hasNextPage: boolean };
}

export function AuditLogsPage() {
  const [actorEmail, setActorEmail] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [action, setAction] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<AuditLogResponse | null>(null);

  // Committed filters — only applied when user stops typing (debounce via key)
  const [committed, setCommitted] = useState({ actorEmail: '', resourceType: '', action: '' });

  function applyFilters() {
    setCommitted({ actorEmail, resourceType, action });
    setOffset(0);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') applyFilters();
  }

  const { data, isLoading, isError } = useQuery<AuditListResponse>({
    queryKey: ['audit-logs', committed, offset],
    queryFn: async () => {
      const query: Record<string, string | number> = { limit: PAGE_SIZE, offset };
      if (committed.resourceType) query['resourceType'] = committed.resourceType;
      if (committed.action) query['action'] = committed.action;
      const { data, error } = await api.GET('/v1/audit-logs', {
        params: { query: query as never },
      });
      if (error || !data) throw new Error();
      return data as AuditListResponse;
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const rows = data?.data ?? [];
  const total = data?.pageInfo?.total ?? 0;
  const hasNext = data?.pageInfo?.hasNextPage ?? false;

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ShieldAlert className="h-5 w-5 text-fg-subtle" strokeWidth={1.75} />
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-fg">Audit Logs</h1>
          <p className="text-sm text-fg-muted">Compliance-grade action history for all OpsHub operations.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg-subtle" />
          <input
            className={`${inputClass} pl-8 w-52`}
            placeholder="Actor email…"
            value={actorEmail}
            onChange={(e) => setActorEmail(e.target.value)}
            onKeyDown={handleKey}
          />
        </div>
        <input
          className={`${inputClass} w-44`}
          placeholder="Resource type…"
          value={resourceType}
          onChange={(e) => setResourceType(e.target.value)}
          onKeyDown={handleKey}
        />
        <input
          className={`${inputClass} w-44`}
          placeholder="Action…"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          onKeyDown={handleKey}
        />
        <button
          onClick={applyFilters}
          className="h-8 rounded-md bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Search
        </button>
        {(committed.actorEmail || committed.resourceType || committed.action) && (
          <button
            onClick={() => {
              setActorEmail(''); setResourceType(''); setAction('');
              setCommitted({ actorEmail: '', resourceType: '', action: '' });
              setOffset(0);
            }}
            className="h-8 rounded-md border border-border px-3 text-sm text-fg-muted hover:bg-surface-hover"
          >
            Clear
          </button>
        )}
        {total > 0 && (
          <span className="ml-auto text-xs text-fg-subtle">{total.toLocaleString()} entries</span>
        )}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted">
              <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted w-44">Time</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Action</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Resource</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted w-32">Resource ID</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Actor</th>
              <th className="px-4 py-2.5 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-fg-subtle">Loading…</td></tr>
            )}
            {isError && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-danger">Failed to load audit logs.</td></tr>
            )}
            {!isLoading && !isError && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-14 text-center">
                  <ShieldAlert className="mx-auto h-8 w-8 text-fg-subtle" strokeWidth={1.5} />
                  <p className="mt-2 text-sm text-fg-subtle">No audit logs found</p>
                </td>
              </tr>
            )}
            {rows.map((log) => <AuditRow key={log.id} log={log} onSelect={setSelected} />)}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-xs text-fg-subtle">
            Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString()}
          </p>
          <div className="flex gap-2">
            <button
              disabled={offset === 0}
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              className="h-8 rounded-md border border-border px-3 text-sm text-fg-muted disabled:opacity-40 hover:bg-surface-hover disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              disabled={!hasNext}
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              className="h-8 rounded-md border border-border px-3 text-sm text-fg-muted disabled:opacity-40 hover:bg-surface-hover disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Audit log detail slide-over */}
      <SlideOver
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.action ?? 'Audit entry'}
        description={selected ? `${selected.resourceType} · ${formatTs(selected.occurredAt)}` : undefined}
        width="lg"
      >
        {selected && (
          <>
            <SlideOverSection title="Event">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                {[
                  { label: 'Action',        value: <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${actionClass(selected.action)}`}>{selected.action}</span> },
                  { label: 'Resource type', value: selected.resourceType },
                  { label: 'Resource ID',   value: <span className="font-mono text-xs">{selected.resourceId ?? '—'}</span> },
                  { label: 'Actor',         value: selected.actorEmail ?? selected.actorId ?? 'system' },
                  { label: 'Time',          value: formatTs(selected.occurredAt) },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <dt className="text-xs text-fg-subtle">{label}</dt>
                    <dd className="mt-0.5 text-fg">{value}</dd>
                  </div>
                ))}
              </dl>
            </SlideOverSection>

            {selected.changes && Object.keys(selected.changes).length > 0 && (
              <>
                <div className="mx-5 h-px bg-surface-muted" />
                <SlideOverSection title="Changes">
                  <pre className="overflow-x-auto rounded-md border border-border bg-surface-muted p-3 text-[11px] text-fg-muted">
                    {JSON.stringify(selected.changes, null, 2)}
                  </pre>
                </SlideOverSection>
              </>
            )}

            {selected.metadata && Object.keys(selected.metadata).length > 0 && (
              <>
                <div className="mx-5 h-px bg-surface-muted" />
                <SlideOverSection title="Metadata">
                  <pre className="overflow-x-auto rounded-md border border-border bg-surface-muted p-3 text-[11px] text-fg-muted">
                    {JSON.stringify(selected.metadata, null, 2)}
                  </pre>
                </SlideOverSection>
              </>
            )}
          </>
        )}
      </SlideOver>
    </div>
  );
}
