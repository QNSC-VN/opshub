import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, GitCommitVertical, Plus, Send, StickyNote } from 'lucide-react';
import { Badge, Button, humanizeStatus } from '@/shared/ui';
import { formatDateTime } from '@/shared/lib/format';
import { AddTimelineEntryModal } from './incident-record-modals';
import { useTimeline } from './use-incidents';
import type { Incident, IncidentEvent } from './incident.types';

/**
 * An incident's timeline — append-only, and mostly written by the API.
 *
 * EVERY STATUS CHANGE IS IN HERE BECAUSE THE TRANSITION WROTE IT, in the same transaction as the move. So
 * the timeline cannot be missing a step the status column claims happened, and nobody has to remember to
 * log it. Notes, evidence and notifications are the entries a person adds.
 *
 * OLDEST FIRST, unlike every list in this product: a timeline is read as a story, and a story that starts
 * at the end is a puzzle. The API returns it in order.
 *
 * No edit, no delete — not because they were forgotten, but because an editable timeline is not evidence.
 */
const EVENT_ICON: Record<string, typeof StickyNote> = {
  status_change: GitCommitVertical,
  note: StickyNote,
  evidence: FileText,
  notification: Send,
};

export function TimelinePanel({ incident, canManage }: { incident: Incident; canManage: boolean }) {
  const qc = useQueryClient();
  const timeline = useTimeline(incident.id);
  const [adding, setAdding] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['incidents'] });
  const rows: IncidentEvent[] = timeline.data ?? [];

  return (
    <div className="flex flex-col gap-2">
      {adding && (
        <AddTimelineEntryModal
          incident={incident}
          onClose={() => setAdding(false)}
          onSuccess={invalidate}
        />
      )}

      {timeline.isLoading && <p className="text-xs text-fg-subtle">Loading…</p>}
      {timeline.isError && <p className="text-xs text-danger">Failed to load the timeline.</p>}
      {!timeline.isLoading && !timeline.isError && rows.length === 0 && (
        // Should not happen for a reported incident — the report itself writes an entry — so if it does,
        // say the thing that is true rather than "no entries".
        <p className="text-xs text-fg-subtle">Nothing recorded yet</p>
      )}

      {rows.map((event) => {
        const Icon = EVENT_ICON[event.type] ?? StickyNote;
        return (
          <div key={event.id} className="flex items-start gap-2">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <Badge tone={event.type === 'status_change' ? 'blue' : 'neutral'}>
                  {humanizeStatus(event.type)}
                </Badge>
                <span className="text-xs text-fg-subtle">{formatDateTime(event.occurredAt)}</span>
              </div>
              <p className="whitespace-pre-wrap text-xs text-fg-muted">{event.detail}</p>
            </div>
          </div>
        );
      })}

      {canManage && (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          Add entry
        </Button>
      )}
    </div>
  );
}
