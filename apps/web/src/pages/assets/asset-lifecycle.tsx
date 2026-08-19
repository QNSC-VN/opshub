import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserCheck } from 'lucide-react';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import { activeEmployeeOptions } from '@/shared/api/picker-sources';
import { formatDate, orDash } from '@/shared/lib/format';
import {
  Badge,
  EntityPicker,
  FormActions,
  FormError,
  FormField,
  Modal,
  Textarea,
} from '@/shared/ui';
import type { Asset } from './asset.types';
import { useAssetAssignments } from './use-assets';

/**
 * Handing an asset to somebody.
 *
 * WHY A NOTE FIELD. The assignment row is the record of custody, and "loan for the Berlin trip, back on the
 * 14th" is the part that makes a six-month-old row explainable. It is optional in the API and offered here
 * because the alternative is that context living in a chat message nobody can find later.
 */
export function AssignAssetModal({
  asset,
  onClose,
  onSuccess,
}: {
  asset: Asset;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [employeeId, setEmployeeId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/assets/{id}/assign', {
        params: { path: { id: asset.id } },
        body: { employeeId, notes: notes || undefined },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to assign the asset.'));
    },
    onSuccess: () => {
      toast.success('Asset assigned');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Assign ${asset.assetTag}`}
      description="Opens an assignment that stays on the record after the asset comes back — the history is how custody is evidenced."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <FormField label="Assign to" htmlFor="asset-assignee" required>
          <EntityPicker
            id="asset-assignee"
            value={employeeId}
            onChange={(value) => setEmployeeId(value)}
            queryKey="active-employees"
            fetchOptions={activeEmployeeOptions}
            placeholder="Search employees…"
          />
        </FormField>

        <FormField
          label="Notes"
          htmlFor="asset-assign-notes"
          hint="Why, and for how long, if it is a loan. This is what makes the row readable a year later."
        >
          <Textarea
            id="asset-assign-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </FormField>

        <FormError message={error} />
        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Assign asset" />
      </form>
    </Modal>
  );
}

/**
 * Who has held this asset.
 *
 * THE OPEN ROW IS THE ONE THAT MATTERS, and it is named rather than left to be inferred from an empty
 * `returnedAt` cell: it is the current custody, and a register whose status says `in_stock` beside an open
 * assignment is exactly the disagreement this panel makes visible.
 */
export function AssignmentHistoryPanel({ assetId }: { assetId: string }) {
  const assignments = useAssetAssignments(assetId);
  const rows = assignments.data ?? [];

  return (
    <div className="flex flex-col gap-2">
      {assignments.isLoading && <p className="text-xs text-fg-subtle">Loading…</p>}
      {assignments.isError && <p className="text-xs text-danger">Failed to load the history.</p>}

      {/* Never assigned is a legitimate answer for stock, and reads as one. */}
      {!assignments.isLoading && !assignments.isError && rows.length === 0 && (
        <p className="text-xs text-fg-subtle">Never assigned</p>
      )}

      {rows.map((assignment) => {
        const open = !assignment.returnedAt;
        return (
          <div
            key={assignment.id}
            className="rounded-md border border-border bg-surface px-2.5 py-1.5"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <UserCheck className="h-3.5 w-3.5 shrink-0 text-fg-subtle" strokeWidth={1.75} />
              <span className="font-mono text-xs text-fg">{assignment.employeeId}</span>
              {open ? (
                <Badge tone="blue">Holding it now</Badge>
              ) : (
                <span className="text-xs text-fg-subtle">
                  returned {formatDate(assignment.returnedAt)}
                </span>
              )}
              <span className="ml-auto text-xs text-fg-subtle">
                from {formatDate(assignment.assignedAt)}
              </span>
            </div>
            {assignment.notes && (
              <p className="mt-0.5 whitespace-pre-wrap text-xs text-fg-muted">
                {orDash(assignment.notes)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
