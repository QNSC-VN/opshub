import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import { activeEmployeeOptions } from '@/shared/api/picker-sources';
import { EntityPicker, FormActions, FormError, FormField, Modal } from '@/shared/ui';
import type { Cycle, Review } from './performance.types';

/**
 * WHO a review is about and who writes it.
 *
 * Split from the forms that WRITE the review (`rating-modals.tsx`) when the file-size ratchet refused one
 * 547-line module — and the seam is the right one anyway: assigning a review is an administrator's act
 * needing `performance.manage`, while writing one is the named reviewer's, needing no code at all.
 */

/**
 * Create a review inside a cycle: a subject and a reviewer.
 *
 * NOBODY REVIEWS THEMSELVES — a database CHECK (`ck_review_reviewer_not_employee`) and a coded refusal
 * in the service. Not pre-empted here: two pickers that filtered each other would be a third copy of
 * the rule, and the one that matters is the one in the database.
 */
export function CreateReviewModal({
  cycle,
  onClose,
  onSuccess,
}: {
  cycle: Cycle;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [employeeId, setEmployeeId] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/performance/cycles/{id}/reviews', {
        params: { path: { id: cycle.id } },
        body: { employeeId, reviewerId },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to create the review.'));
    },
    onSuccess: () => {
      toast.success('Review created');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Add a review to ${cycle.reference}`}
      description="One review per person per cycle. The reviewer is the only one who can write it."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <FormField label="Employee" htmlFor="review-employee" required>
          <EntityPicker
            id="review-employee"
            queryKey="active-employees"
            value={employeeId}
            onChange={setEmployeeId}
            fetchOptions={activeEmployeeOptions}
            placeholder="Search people…"
          />
        </FormField>
        <FormField
          label="Reviewer"
          htmlFor="review-reviewer"
          required
          hint="Writes the summary and the rating. Cannot be the employee."
        >
          <EntityPicker
            id="review-reviewer"
            queryKey="active-employees"
            value={reviewerId}
            onChange={setReviewerId}
            fetchOptions={activeEmployeeOptions}
            placeholder="Search people…"
          />
        </FormField>

        <FormError message={error} />

        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Create review" />
      </form>
    </Modal>
  );
}

/** Hand a review to a different reviewer — a manager left, or the wrong one was named. */
export function ReassignReviewerModal({
  review,
  onClose,
  onSuccess,
}: {
  review: Review;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [reviewerId, setReviewerId] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.PATCH('/v1/performance/reviews/{id}/reviewer', {
        params: { path: { id: review.id } },
        body: { reviewerId },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to reassign the review.'));
    },
    onSuccess: () => {
      toast.success('Reviewer reassigned');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Reassign this review"
      description="The new reviewer inherits whatever has been written so far."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <FormField label="New reviewer" htmlFor="reassign-reviewer" required>
          <EntityPicker
            id="reassign-reviewer"
            queryKey="active-employees"
            value={reviewerId}
            onChange={setReviewerId}
            fetchOptions={activeEmployeeOptions}
            placeholder="Search people…"
          />
        </FormField>

        <FormError message={error} />

        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Reassign" />
      </form>
    </Modal>
  );
}
