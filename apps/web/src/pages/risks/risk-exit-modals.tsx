import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import { FormActions, FormField, Input, Modal, Textarea } from '@/shared/ui';
import { ACCEPTANCE_APPROVAL_THRESHOLD, type Risk } from './risk.types';

/**
 * The two ways a risk leaves the working register: carried (accepted) or gone (closed).
 *
 * Both keep the row. A closed risk is history an auditor reads, and an accepted one has a named person
 * and a review date attached — which is the whole difference between accepting a risk and ignoring it.
 */

/**
 * Accept a risk — which above the high band is an APPROVAL REQUEST, not a field write.
 *
 * The service decides, not this form: at or above a residual score of 12 it raises a `risk_acceptance`
 * request and returns the risk UNCHANGED with a `requestId`. The dialog says which of the two is about
 * to happen, and the toast afterwards says which one did — because "accepted" and "waiting for somebody
 * to accept" are very different answers to "is this risk carried".
 */
export function AcceptRiskModal({
  risk,
  onClose,
  onSuccess,
}: {
  risk: Risk;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [justification, setJustification] = useState('');
  const [reviewDueOn, setReviewDueOn] = useState(risk.reviewDueOn ?? '');
  const [error, setError] = useState('');

  /**
   * The RESIDUAL score decides, and only the residual.
   *
   * This read `residualScore ?? inherentScore` at first, which put an inherent number under the words
   * "residual score" for any risk that had not been assessed — and the API refuses those outright
   * ("assess it before accepting it"), so the fallback was describing a state that cannot reach here.
   */
  const score = risk.residualScore ?? 0;
  const needsApproval = score >= ACCEPTANCE_APPROVAL_THRESHOLD;

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error: err } = await api.POST('/v1/risks/{id}/accept', {
        params: { path: { id: risk.id } },
        body: { justification, reviewDueOn: reviewDueOn || null },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to accept the risk.'));
      return data;
    },
    onSuccess: (data) => {
      // `requestId` set means nothing is accepted yet — say so rather than claiming success.
      toast.success(
        data?.requestId
          ? 'Acceptance sent for approval — the risk is unchanged until it is signed off'
          : 'Risk accepted',
      );
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
      title={`Accept ${risk.reference}`}
      description={
        needsApproval
          ? `Residual score ${score} is in the high band, so this raises an approval request. Nothing is accepted until it is signed off.`
          : `Residual score ${score}. Below the high band, so the acceptance is recorded directly against your name.`
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
        <FormField
          label="Justification"
          htmlFor="accept-justification"
          required
          hint="Why carrying this is the right call. An acceptance nobody explained cannot be defended at the next audit."
        >
          <Textarea
            id="accept-justification"
            required
            rows={4}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
          />
        </FormField>

        <FormField
          label="Review due"
          htmlFor="accept-review-due"
          hint="An accepted risk is revisited, not forgotten."
        >
          <Input
            id="accept-review-due"
            type="date"
            value={reviewDueOn}
            onChange={(e) => setReviewDueOn(e.target.value)}
          />
        </FormField>

        {error && <p className="text-xs text-danger">{error}</p>}

        <FormActions
          loading={mutation.isPending}
          onClose={onClose}
          submitLabel={needsApproval ? 'Send for approval' : 'Accept risk'}
        />
      </form>
    </Modal>
  );
}

/** Close a risk, with the note that explains why it is no longer a risk. */
export function CloseRiskModal({
  risk,
  onClose,
  onSuccess,
}: {
  risk: Risk;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/risks/{id}/close', {
        params: { path: { id: risk.id } },
        body: { note },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to close the risk.'));
    },
    onSuccess: () => {
      toast.success('Risk closed');
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
      title={`Close ${risk.reference}`}
      description="A closed risk stays in the register as history. Closing is not deleting."
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
          label="Closure note"
          htmlFor="close-note"
          required
          hint="What changed — the activity stopped, the asset went, the exposure is gone."
        >
          <Textarea
            id="close-note"
            required
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </FormField>

        {error && <p className="text-xs text-danger">{error}</p>}

        <FormActions
          loading={mutation.isPending}
          onClose={onClose}
          submitLabel="Close risk"
          variant="danger"
        />
      </form>
    </Modal>
  );
}
