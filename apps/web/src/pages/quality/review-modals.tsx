import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import { activeEmployeeOptions, documentOptions } from '@/shared/api/picker-sources';
import { isoDaysFromNow, todayIso } from '@/shared/lib/format';
import {
  EntityPicker,
  FormActions,
  FormError,
  FormField,
  Input,
  Modal,
  Textarea,
} from '@/shared/ui';
import type { ManagementReview } from './review.types';

/**
 * The forms that move a management review, and the one that records an output.
 *
 * `held` and `closed` are separate steps because §9.3.3 asks for documented outputs: a meeting that happened
 * and whose minutes were never issued is not a completed review. Holding also FREEZES the agenda onto the
 * row, which is why nothing here accepts `inputs` — the numbers are the API's, taken on the day.
 */

/** Scheduling a review. The period is what the minutes will be filed under, so it is not a free-form title. */
export function ScheduleReviewModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    reference: '',
    title: '',
    period: '',
    chairId: '',
    scheduledFor: isoDaysFromNow(14),
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/management-reviews', {
        body: {
          reference: form.reference,
          title: form.title,
          period: form.period,
          chairId: form.chairId,
          // A DATE, not an instant: `scheduledFor` is `z.string().date()`. A review is scheduled for a
          // day, and sending midday-as-an-instant is a 422.
          scheduledFor: form.scheduledFor || null,
        },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to schedule the review.'));
    },
    onSuccess: () => {
      toast.success('Review scheduled');
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
      open={open}
      onClose={onClose}
      title="Schedule a management review"
      description="Reviews are held in order: one cannot be held while a review scheduled before it is still outstanding."
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
          <FormField label="Reference" htmlFor="review-reference" required>
            <Input
              id="review-reference"
              required
              value={form.reference}
              onChange={(e) => set('reference', e.target.value.toUpperCase())}
              placeholder="MR-2026-03"
            />
          </FormField>
          <FormField
            label="Period"
            htmlFor="review-period"
            required
            hint="What the minutes will be filed under."
          >
            <Input
              id="review-period"
              required
              value={form.period}
              onChange={(e) => set('period', e.target.value)}
              placeholder="2026 Q3"
            />
          </FormField>
        </div>

        <FormField label="Title" htmlFor="review-title" required>
          <Input
            id="review-title"
            required
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Quarterly management review"
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Chair" htmlFor="review-chair" required>
            <EntityPicker
              id="review-chair"
              value={form.chairId}
              onChange={(value) => set('chairId', value)}
              queryKey="active-employees"
              fetchOptions={activeEmployeeOptions}
              placeholder="Search employees…"
            />
          </FormField>
          <FormField label="Scheduled for" htmlFor="review-scheduled-for">
            <Input
              id="review-scheduled-for"
              type="date"
              value={form.scheduledFor}
              onChange={(e) => set('scheduledFor', e.target.value)}
            />
          </FormField>
        </div>

        <FormError message={error} />
        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Schedule review" />
      </form>
    </Modal>
  );
}

/**
 * Holding the review.
 *
 * THIS IS THE STEP THAT FREEZES THE AGENDA. The inputs §9.3.2 asks for are read from the other registers and
 * written onto the row here, because minutes have to show what the numbers WERE on the day: a live re-read
 * would silently turn "eleven overdue" into "three" once the backlog cleared, and the decision recorded
 * beside it would stop making sense. Nothing on this form sends them — they are the API's to take.
 */
export function HoldReviewModal({
  review,
  onClose,
  onSuccess,
}: {
  review: ManagementReview;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [heldOn, setHeldOn] = useState(todayIso());
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/management-reviews/{id}/hold', {
        params: { path: { id: review.id } },
        // Also a plain date — the day the meeting happened, which is what minutes are dated by.
        body: { heldOn: heldOn || undefined },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to record the review as held.'));
    },
    onSuccess: () => {
      toast.success('Review held — inputs frozen');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Hold ${review.reference}`}
      description="Records the meeting and FREEZES its inputs, so the minutes show the numbers as they were on the day."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <FormField label="Held on" htmlFor="review-held-on" required>
          <Input
            id="review-held-on"
            type="date"
            required
            max={todayIso()}
            value={heldOn}
            onChange={(e) => setHeldOn(e.target.value)}
          />
        </FormField>

        <p className="text-xs text-fg-subtle">
          Outputs are raised as actions after this, and the review closes once its minutes are
          issued.
        </p>

        <FormError message={error} />
        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Record as held" />
      </form>
    </Modal>
  );
}

/**
 * Closing the review.
 *
 * BOTH THE CONCLUSION AND THE MINUTES, because §9.3.3 asks for documented outputs and a conclusion nobody
 * can read is not documentation. After this the review accepts no new actions: an output added once the
 * minutes are issued is an output those minutes do not contain.
 */
export function CloseReviewModal({
  review,
  onClose,
  onSuccess,
}: {
  review: ManagementReview;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [conclusion, setConclusion] = useState('');
  const [minutesDocumentId, setMinutesDocumentId] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/management-reviews/{id}/close', {
        params: { path: { id: review.id } },
        body: { conclusion, minutesDocumentId },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to close the review.'));
    },
    onSuccess: () => {
      toast.success('Review closed');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Close ${review.reference}`}
      description="The minutes are issued. No further outputs can be raised against this review."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <FormField
          label="Conclusion"
          htmlFor="review-conclusion"
          required
          hint="What the review concluded about the suitability, adequacy and effectiveness of the system."
        >
          <Textarea
            id="review-conclusion"
            required
            rows={4}
            value={conclusion}
            onChange={(e) => setConclusion(e.target.value)}
          />
        </FormField>

        <FormField label="Minutes document" htmlFor="review-minutes-doc" required>
          <EntityPicker
            id="review-minutes-doc"
            value={minutesDocumentId}
            onChange={(value) => setMinutesDocumentId(value)}
            queryKey="documents"
            fetchOptions={documentOptions}
            placeholder="Search documents…"
          />
        </FormField>

        <FormError message={error} />
        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Close review" />
      </form>
    </Modal>
  );
}

/** Cancelling a scheduled review. Unreachable once held: its inputs are frozen and its actions raised. */
export function CancelReviewModal({
  review,
  onClose,
  onSuccess,
}: {
  review: ManagementReview;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/management-reviews/{id}/cancel', {
        params: { path: { id: review.id } },
        body: { reason },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to cancel the review.'));
    },
    onSuccess: () => {
      toast.success('Review cancelled');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Cancel ${review.reference}`}
      description="Stays on the programme with the reason. A review that was scheduled and never held is itself a finding."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <FormField label="Reason" htmlFor="review-cancel-reason" required>
          <Textarea
            id="review-cancel-reason"
            required
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </FormField>

        <FormError message={error} />
        <FormActions
          loading={mutation.isPending}
          onClose={onClose}
          submitLabel="Cancel review"
          variant="danger"
        />
      </form>
    </Modal>
  );
}
