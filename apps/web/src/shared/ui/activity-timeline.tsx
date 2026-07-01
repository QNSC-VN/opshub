/**
 * ActivityTimeline — immutable audit trail for any entity.
 *
 * Fetches GET /v1/audit-logs?resourceId=...&resourceType=... and renders a
 * vertical timeline. Consumed inside SlideOver detail panels for people,
 * assets, requests.
 *
 * Principles:
 *  - Single indexed DB query (resourceId + resourceType index on audit table)
 *  - Relative timestamps (refresh every 60 s so "Just now" stays accurate)
 *  - Expandable changes/metadata for power users
 *  - Never throws — shows an empty state on error
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Clock, User } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { api } from '@/shared/api/client';
import type { AuditLogResponse } from '@/shared/api/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Human-readable relative timestamp. */
function relativeTs(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Map an action string to a visual tone. */
function actionTone(action: string): string {
  const verb = action.split('.').pop() ?? '';
  const tones: Record<string, string> = {
    created:    'text-success',
    updated:    'text-accent',
    deleted:    'text-danger',
    approved:   'text-success',
    rejected:   'text-danger',
    revoked:    'text-danger',
    assigned:   'text-violet-fg',
    returned:   'text-warning',
    submitted:  'text-accent',
    offboarded: 'text-fg-muted',
    added:      'text-success',
  };
  return tones[verb] ?? 'text-fg-muted';
}

// ── Item ──────────────────────────────────────────────────────────────────────

function TimelineItem({ log }: { log: AuditLogResponse }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail =
    (log.changes   && Object.keys(log.changes  ).length > 0) ||
    (log.metadata  && Object.keys(log.metadata ).length > 0);

  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {/* Vertical connector line — hidden for last item */}
      <div className="absolute left-[11px] top-6 bottom-0 w-px bg-surface-muted last:hidden" />

      {/* Dot */}
      <div
        aria-hidden="true"
        className="relative mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-muted ring-2 ring-white"
      >
        <div className="h-1.5 w-1.5 rounded-full bg-fg-subtle" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className={cn('text-xs font-medium', actionTone(log.action))}>
            {log.action}
          </span>
          <span className="shrink-0 text-xs text-fg-subtle">
            {relativeTs(log.occurredAt)}
          </span>
        </div>

        <div className="mt-0.5 flex items-center gap-1 text-xs text-fg-muted">
          <User className="h-3 w-3 shrink-0 text-fg-subtle" strokeWidth={1.75} />
          <span className="truncate">
            {log.actorEmail ?? log.actorId ?? 'system'}
          </span>
        </div>

        {/* Expandable detail */}
        {hasDetail && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 flex items-center gap-1 text-xs text-fg-subtle hover:text-fg-muted transition-colors"
          >
            <ChevronDown
              className={cn(
                'h-3 w-3 transition-transform',
                expanded && 'rotate-180',
              )}
              strokeWidth={2}
            />
            {expanded ? 'Hide details' : 'Show details'}
          </button>
        )}

        {expanded && (
          <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-surface-muted p-2 text-[10px] leading-relaxed text-fg-muted ring-1 ring-border">
            {JSON.stringify(
              { ...(log.changes  ?? {}), ...(log.metadata ?? {}) },
              null,
              2,
            )}
          </pre>
        )}
      </div>
    </li>
  );
}

// ── Empty / loading states ────────────────────────────────────────────────────

function TimelineSkeleton() {
  return (
    <ul className="flex flex-col gap-0">
      {Array.from({ length: 3 }).map((_, i) => (
        <li key={i} className="flex gap-3 pb-5">
          <div className="mt-1 h-5 w-5 shrink-0 animate-pulse rounded-full bg-surface-muted" />
          <div className="flex-1 space-y-1.5 pt-0.5">
            <div className="h-3 w-32 animate-pulse rounded bg-surface-muted" />
            <div className="h-3 w-24 animate-pulse rounded bg-surface-muted" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function TimelineEmpty() {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <Clock className="h-7 w-7 text-fg-subtle" strokeWidth={1.25} />
      <p className="text-xs text-fg-subtle">No activity recorded yet.</p>
    </div>
  );
}

// ── Public component ──────────────────────────────────────────────────────────

export interface ActivityTimelineProps {
  resourceId: string;
  resourceType: string;
  /** Max events to display. Defaults to 30. */
  limit?: number;
}

export function ActivityTimeline({
  resourceId,
  resourceType,
  limit = 30,
}: ActivityTimelineProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit-timeline', resourceType, resourceId],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/audit-logs', {
        params: {
          query: {
            resourceId,
            resourceType,
            limit,
          } as Record<string, unknown>,
        },
      });
      if (error || !data) throw new Error('Failed to load activity');
      return data;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  if (isLoading) return <TimelineSkeleton />;
  if (isError || !data) return <TimelineEmpty />;

  const events = (data.data ?? []) as AuditLogResponse[];
  if (events.length === 0) return <TimelineEmpty />;

  return (
    <ul role="list" className="flex flex-col">
      {events.map((log) => (
        <TimelineItem key={log.id} log={log} />
      ))}
    </ul>
  );
}
