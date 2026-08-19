import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import { FormActions, FormError, FormField, Modal, Textarea } from '@/shared/ui';
import type { Nonconformance } from './quality.types';

/**
 * The two ways a finding leaves the working register: closed, or voided.
 *
 * Split from `nonconformance-modals.tsx` because that file crossed the largest-file ratchet, and this is the
 * seam the domain already had — the other file is about recording what was FOUND and what was DONE, and these
 * two are about deciding the finding is finished with. Both are terminal, and neither can be undone.
 */

/**
 * Closure.
 *
 * THE GATE THE MODULE EXISTS FOR. A finding whose grade `requiresCapa` cannot close until a CAPA on it is
 * verified effective — a statement about rows in ANOTHER table, so no CHECK can hold it and the service
 * enforces it. The screen never re-implements that: it reads `requiresCapa` and `verifiedCapaCount` off the
 * row the API computed, and simply does not offer a closure it already knows will be refused. Where the
 * gate is open, the note is still required, because "closed" without a reason is not evidence of anything.
 */
export function CloseNonconformanceModal({
  finding,
  onClose,
  onSuccess,
}: {
  finding: Nonconformance;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [closureNote, setClosureNote] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/nonconformances/{id}/close', {
        params: { path: { id: finding.id } },
        body: { closureNote },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to close the finding.'));
    },
    onSuccess: () => {
      toast.success('Finding closed');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Close ${finding.reference}`}
      description="Closure is the record that the finding was answered — containment done, and where the grade demands it, a CAPA verified effective."
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
          htmlFor="nc-closure-note"
          required
          hint="What was done, and what evidence says it worked."
        >
          <Textarea
            id="nc-closure-note"
            required
            rows={3}
            value={closureNote}
            onChange={(e) => setClosureNote(e.target.value)}
          />
        </FormField>

        <p className="text-xs text-fg-subtle">
          A closed finding accepts nothing further — no edit, no re-grade, no further transition.
          The row and its CAPAs stay as the audit evidence.
        </p>

        <FormError message={error} />
        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Close finding" />
      </form>
    </Modal>
  );
}

/**
 * Voiding.
 *
 * NOT A DELETE AND NOT A CLOSURE. A finding raised in error is withdrawn with a reason and stays on the
 * register, because "we decided this was not a finding" is itself something an auditor reads. Voiding
 * instead of closing also keeps it out of the closed count, which would otherwise flatter the numbers.
 */
export function VoidNonconformanceModal({
  finding,
  onClose,
  onSuccess,
}: {
  finding: Nonconformance;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/nonconformances/{id}/void', {
        params: { path: { id: finding.id } },
        body: { reason },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to void the finding.'));
    },
    onSuccess: () => {
      toast.success('Finding voided');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Void ${finding.reference}`}
      description="For a finding raised in error. It stays on the register with the reason, and does not count as closed."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <FormField label="Reason" htmlFor="nc-void-reason" required>
          <Textarea
            id="nc-void-reason"
            required
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this is not a non-conformance."
          />
        </FormField>

        <FormError message={error} />
        <FormActions
          loading={mutation.isPending}
          onClose={onClose}
          submitLabel="Void finding"
          variant="danger"
        />
      </form>
    </Modal>
  );
}
