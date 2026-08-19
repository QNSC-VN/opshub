import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ListChecks, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import {
  Button,
  PanelState,
  RowActions,
  Select,
  StatusBadge,
  humanizeStatus,
  statusTone,
} from '@/shared/ui';
import { formatDate } from '@/shared/lib/format';
import { AddTreatmentModal } from './treatment-modals';
import { TREATMENT_STATUSES } from './risk.types';
import { useTreatments } from './use-risks';
import type { Risk } from './risk.types';

/**
 * A risk's treatment plan, and the count that decides whether it can be marked treated.
 *
 * OUTSTANDING ACTIONS BLOCK "TREATED" — a count across rows, so no CHECK sees it and the service
 * enforces it. The line under the list says how many remain, which is the difference between a user
 * understanding the refusal and meeting it as a surprise.
 *
 * Status is changed in place with a `<select>` rather than through a modal: it is one field on a short
 * row, and a dialog per status change would be four clicks for a word.
 */
export function TreatmentsPanel({ risk, canManage }: { risk: Risk; canManage: boolean }) {
  const qc = useQueryClient();
  const treatments = useTreatments(risk.id);
  const [adding, setAdding] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['risks'] });
  const rows = treatments.data ?? [];
  const outstanding = rows.filter(
    (treatment) => treatment.status !== 'done' && treatment.status !== 'cancelled',
  ).length;

  async function setStatus(treatmentId: string, status: string) {
    const { error } = await api.PATCH('/v1/risks/treatments/{treatmentId}', {
      params: { path: { treatmentId } },
      body: { status: status as never },
    });
    if (error) {
      toast.error(apiErrorMessage(error, 'Failed to update the treatment action.'));
      return;
    }
    toast.success('Treatment action updated');
    invalidate();
  }

  return (
    <div className="flex flex-col gap-2">
      {adding && (
        <AddTreatmentModal risk={risk} onClose={() => setAdding(false)} onSuccess={invalidate} />
      )}

      <PanelState
        query={treatments}
        count={rows.length}
        empty="No treatment actions"
        error="Failed to load the treatment plan."
      />

      {rows.map((treatment) => (
        <div
          key={treatment.id}
          className="flex items-start gap-2 rounded-md border border-border bg-surface px-2.5 py-2"
        >
          <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-fg">{treatment.description}</p>
            <p className="truncate text-xs text-fg-subtle">
              Due {formatDate(treatment.dueOn)}
              {treatment.completedOn ? ` · done ${formatDate(treatment.completedOn)}` : ''}
            </p>
          </div>
          {canManage ? (
            <RowActions>
              <Select
                aria-label={`Status of "${treatment.description}"`}
                className="h-7 w-36 py-0 text-xs"
                value={treatment.status}
                onChange={(e) => void setStatus(treatment.id, e.target.value)}
              >
                {TREATMENT_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {humanizeStatus(option)}
                  </option>
                ))}
              </Select>
            </RowActions>
          ) : (
            <StatusBadge tone={statusTone(treatment.status)}>
              {humanizeStatus(treatment.status)}
            </StatusBadge>
          )}
        </div>
      ))}

      {rows.length > 0 && (
        <p className={`text-xs ${outstanding > 0 ? 'text-warning' : 'text-success'}`}>
          {outstanding > 0
            ? `${outstanding} action(s) outstanding — the risk cannot be marked treated yet`
            : 'Every action is done or cancelled'}
        </p>
      )}

      {canManage && (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          Add action
        </Button>
      )}
    </div>
  );
}
