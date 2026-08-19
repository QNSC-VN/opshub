import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import { activeEmployeeOptions } from '@/shared/api/picker-sources';
import { isoDaysFromNow } from '@/shared/lib/format';
import {
  EntityPicker,
  FormActions,
  FormError,
  FormField,
  Input,
  Modal,
  Select,
  Textarea,
  humanizeStatus,
} from '@/shared/ui';
import { ACTION_CATEGORIES, type ManagementReview } from './review.types';

/**
 * A review's OUTPUTS — §9.3.3 — as opposed to the review itself.
 *
 * Split from `review-modals.tsx` because that file crossed the largest-file ratchet, and this is the seam the
 * clause already draws: §9.3.2 is what a review considers and §9.3.3 is what it decides. The review's own
 * lifecycle lives in the other file; these three forms are about the decisions it produced.
 */

/**
 * Raising an output.
 *
 * THE CATEGORY IS §9.3.3's, not a label somebody types: improvement, a change to the QMS, or a resource
 * need. A review whose outputs are all uncategorised cannot show it considered the three things the clause
 * asks about.
 */
export function RaiseActionModal({
  review,
  onClose,
  onSuccess,
}: {
  review: ManagementReview;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    category: 'improvement' as (typeof ACTION_CATEGORIES)[number],
    description: '',
    ownerId: '',
    dueOn: isoDaysFromNow(60),
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/management-reviews/{id}/actions', {
        params: { path: { id: review.id } },
        body: {
          category: form.category,
          description: form.description,
          ownerId: form.ownerId,
          dueOn: form.dueOn || null,
        },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to raise the action.'));
    },
    onSuccess: () => {
      toast.success('Action raised');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Raise an output for ${review.reference}`}
      description="An output of the review, owned by somebody and dated. Actions still open at the next review are carried forward to it."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Category" htmlFor="action-category" required>
            <Select
              id="action-category"
              value={form.category}
              onChange={(e) => set('category', e.target.value as typeof form.category)}
            >
              {ACTION_CATEGORIES.map((code) => (
                <option key={code} value={code}>
                  {humanizeStatus(code)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Due on" htmlFor="action-due-on">
            <Input
              id="action-due-on"
              type="date"
              value={form.dueOn}
              onChange={(e) => set('dueOn', e.target.value)}
            />
          </FormField>
        </div>

        <FormField label="Description" htmlFor="action-description" required>
          <Textarea
            id="action-description"
            required
            rows={3}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="What will change, and what it is expected to achieve."
          />
        </FormField>

        <FormField label="Owner" htmlFor="action-owner" required>
          <EntityPicker
            id="action-owner"
            value={form.ownerId}
            onChange={(value) => set('ownerId', value)}
            queryKey="active-employees"
            fetchOptions={activeEmployeeOptions}
            placeholder="Search employees…"
          />
        </FormField>

        <FormError message={error} />
        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Raise action" />
      </form>
    </Modal>
  );
}

/** Completing or cancelling an output. Both are terminal, and both need a note saying what happened. */
export function ActionOutcomeModal({
  action,
  outcome,
  onClose,
  onSuccess,
}: {
  action: { id: string; description: string };
  outcome: 'complete' | 'cancel';
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [outcomeNote, setOutcomeNote] = useState('');
  const [error, setError] = useState('');
  const completing = outcome === 'complete';

  const mutation = useMutation({
    mutationFn: async () => {
      const args = {
        params: { path: { actionId: action.id } },
        body: { outcomeNote },
      } as const;
      const { error: err } = completing
        ? await api.POST('/v1/management-reviews/actions/{actionId}/complete', args)
        : await api.POST('/v1/management-reviews/actions/{actionId}/cancel', args);
      if (err)
        throw new Error(
          apiErrorMessage(
            err,
            completing ? 'Failed to complete the action.' : 'Failed to cancel the action.',
          ),
        );
    },
    onSuccess: () => {
      toast.success(completing ? 'Action completed' : 'Action cancelled');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={completing ? 'Complete this action' : 'Cancel this action'}
      description={
        completing
          ? 'What was done. The next review reads this as the status of an action from a previous one.'
          : 'Why this output is not being pursued. It stays on the review, because the review decided it.'
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <p className="text-xs text-fg-muted">{action.description}</p>

        <FormField label="Outcome note" htmlFor="action-outcome-note" required>
          <Textarea
            id="action-outcome-note"
            required
            rows={3}
            value={outcomeNote}
            onChange={(e) => setOutcomeNote(e.target.value)}
          />
        </FormField>

        <FormError message={error} />
        <FormActions
          loading={mutation.isPending}
          onClose={onClose}
          submitLabel={completing ? 'Complete action' : 'Cancel action'}
          variant={completing ? 'primary' : 'danger'}
        />
      </form>
    </Modal>
  );
}
