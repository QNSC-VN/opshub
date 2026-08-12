import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import { isoInstantFromDate, todayIso } from '@/shared/lib/format';
import { FormActions, FormField, Input, Modal, Textarea } from '@/shared/ui';
import type { Capa } from './quality.types';

/**
 * The CAPA steps that record an OUTCOME rather than evidence of analysis.
 *
 * Split from `capa-modals.tsx` because that file crossed the largest-file ratchet, and this is the seam the
 * domain already had: the other file is about establishing a cause and proving a fix, and these three are
 * about what became of the attempt — implemented, ineffective, abandoned.
 */

/**
 * The two outcomes that are not "it worked": ineffective, and cancelled.
 *
 * INEFFECTIVE IS NOT A FAILURE STATE, IT IS A LOOP. It sends the CAPA back to analysis, which is the honest
 * answer when the actions were done and the problem persisted. Cancelling is the other thing entirely — the
 * CAPA should not have been opened — and it is terminal, so it never satisfies a closure gate.
 */
export function CapaOutcomeModal({
  capa,
  outcome,
  onClose,
  onSuccess,
}: {
  capa: Capa;
  outcome: 'ineffective' | 'cancel';
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const ineffective = outcome === 'ineffective';

  const mutation = useMutation({
    mutationFn: async () => {
      const path = { params: { path: { id: capa.id } }, body: { reason } } as const;
      const { error: err } = ineffective
        ? await api.POST('/v1/capas/{id}/ineffective', path)
        : await api.POST('/v1/capas/{id}/cancel', path);
      if (err)
        throw new Error(
          apiErrorMessage(
            err,
            ineffective ? 'Failed to record the outcome.' : 'Failed to cancel the CAPA.',
          ),
        );
    },
    onSuccess: () => {
      toast.success(ineffective ? 'Recorded as ineffective' : 'CAPA cancelled');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={ineffective ? `Mark ${capa.reference} ineffective` : `Cancel ${capa.reference}`}
      description={
        ineffective
          ? 'The actions were done and the problem persisted. This reopens the analysis rather than ending the CAPA.'
          : 'For a CAPA that should not have been opened. Cancelling is terminal, and never satisfies a finding’s closure requirement.'
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
        <FormField label="Reason" htmlFor="capa-outcome-reason" required>
          <Textarea
            id="capa-outcome-reason"
            required
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              ineffective
                ? 'What was observed after the actions that shows they did not hold.'
                : 'Why this CAPA is not needed.'
            }
          />
        </FormField>

        {error && <p className="text-xs text-danger">{error}</p>}
        <FormActions
          loading={mutation.isPending}
          onClose={onClose}
          submitLabel={ineffective ? 'Mark ineffective' : 'Cancel CAPA'}
          variant="danger"
        />
      </form>
    </Modal>
  );
}

/**
 * Marking the actions implemented.
 *
 * A date and nothing else, which is why it is a small form rather than a step with its own evidence:
 * "implemented" is a claim about work finishing, and the claim that it WORKED is verification's to make.
 */
export function MarkImplementedModal({
  capa,
  onClose,
  onSuccess,
}: {
  capa: Capa;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [implementedAt, setImplementedAt] = useState(todayIso());
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/capas/{id}/implemented', {
        params: { path: { id: capa.id } },
        body: { implementedAt: implementedAt ? isoInstantFromDate(implementedAt) : undefined },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to mark the CAPA implemented.'));
    },
    onSuccess: () => {
      toast.success('CAPA implemented');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Mark ${capa.reference} implemented`}
      description="The actions are done. Whether they worked is verification's question, and a separate permission."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <FormField label="Implemented on" htmlFor="capa-implemented-at" required>
          <Input
            id="capa-implemented-at"
            type="date"
            required
            max={todayIso()}
            value={implementedAt}
            onChange={(e) => setImplementedAt(e.target.value)}
          />
        </FormField>

        {error && <p className="text-xs text-danger">{error}</p>}
        <FormActions
          loading={mutation.isPending}
          onClose={onClose}
          submitLabel="Mark implemented"
        />
      </form>
    </Modal>
  );
}
