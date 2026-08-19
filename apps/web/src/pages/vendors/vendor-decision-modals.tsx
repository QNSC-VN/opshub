import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import {
  FormActions,
  FormError,
  FormField,
  Modal,
  Select,
  Textarea,
  humanizeStatus,
} from '@/shared/ui';
import { ASSESSMENT_OUTCOMES, type Vendor } from './vendor.types';
import { useCriticalityLevels } from './use-vendors';

/**
 * The two records that decide whether a supplier stays: an assessment, and a reason for stopping.
 *
 * Split from registration when this file passed the size ceiling, and the seam is the domain's own:
 * registering is an administrator's act, while assessing and suspending are the judgements about it.
 */

/**
 * Record an assessment.
 *
 * THE OUTCOME IS THE POINT, and `pass_with_conditions` is a third state on purpose: a pass that owes
 * something is not a pass, and collapsing it into one would lose the follow-up. Conditions are asked for
 * when that outcome is chosen, because a conditional pass with no conditions written down is just a pass.
 */
export function RecordAssessmentModal({
  vendor,
  onClose,
  onSuccess,
}: {
  vendor: Vendor;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const levels = useCriticalityLevels();
  const [outcome, setOutcome] = useState<(typeof ASSESSMENT_OUTCOMES)[number]>('pass');
  const [scope, setScope] = useState('');
  const [findings, setFindings] = useState('');
  const [conditions, setConditions] = useState('');
  const [error, setError] = useState('');

  const level = levels.data?.find((entry) => entry.code === vendor.criticality);
  const conditional = outcome === 'pass_with_conditions';

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/vendors/{id}/assessments', {
        params: { path: { id: vendor.id } },
        body: {
          outcome,
          scope,
          findings: findings || null,
          conditions: conditions || null,
        },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to record the assessment.'));
    },
    onSuccess: () => {
      toast.success('Assessment recorded');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Assess ${vendor.name}`}
      description={
        level?.requiresIndependentEvidence
          ? `A ${level.label.toLowerCase()} supplier needs INDEPENDENT evidence — a certification or a third-party report, not a questionnaire they filled in themselves.`
          : 'Recorded against the supplier and used to compute when the next assessment is due.'
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
        <FormField label="Outcome" htmlFor="assessment-outcome" required>
          <Select
            id="assessment-outcome"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as typeof outcome)}
          >
            {ASSESSMENT_OUTCOMES.map((option) => (
              <option key={option} value={option}>
                {humanizeStatus(option)}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField
          label="Scope"
          htmlFor="assessment-scope"
          required
          hint="What was actually looked at. An assessment with no stated scope cannot be relied on later."
        >
          <Textarea
            id="assessment-scope"
            required
            rows={2}
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            placeholder="ISO 27001 certificate, SOC 2 Type II report, and the DPA schedule."
          />
        </FormField>

        <FormField label="Findings" htmlFor="assessment-findings">
          <Textarea
            id="assessment-findings"
            rows={3}
            value={findings}
            onChange={(e) => setFindings(e.target.value)}
          />
        </FormField>

        {/* Only for the conditional pass, and required there: the conditions ARE the difference. */}
        {conditional && (
          <FormField
            label="Conditions"
            htmlFor="assessment-conditions"
            required
            hint="What they have to do, and by when. A conditional pass with nothing written here is a pass."
          >
            <Textarea
              id="assessment-conditions"
              required
              rows={3}
              value={conditions}
              onChange={(e) => setConditions(e.target.value)}
            />
          </FormField>
        )}

        <FormError message={error} />

        <FormActions
          loading={mutation.isPending}
          onClose={onClose}
          submitLabel="Record assessment"
        />
      </form>
    </Modal>
  );
}

/**
 * Suspend or terminate — both need a reason, and terminating is final.
 *
 * One form for two endpoints because the shape is identical (`VendorReasonDto`) and the difference is
 * consequence, not fields. The wording carries that difference: a suspension can be reinstated, a
 * termination cannot.
 */
export function VendorReasonModal({
  vendor,
  action,
  onClose,
  onSuccess,
}: {
  vendor: Vendor;
  action: 'suspend' | 'terminate';
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const path = action === 'suspend' ? '/v1/vendors/{id}/suspend' : '/v1/vendors/{id}/terminate';
      const { error: err } = await api.POST(path, {
        params: { path: { id: vendor.id } },
        body: { reason },
      });
      if (err) throw new Error(apiErrorMessage(err, `Failed to ${action} the supplier.`));
    },
    onSuccess: () => {
      toast.success(action === 'suspend' ? 'Supplier suspended' : 'Supplier terminated');
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
      title={`${action === 'suspend' ? 'Suspend' : 'Terminate'} ${vendor.name}`}
      description={
        action === 'suspend'
          ? 'Stops new work while the relationship is reviewed. A suspended supplier can be reinstated.'
          : 'Final. The record stays for audit, but the relationship cannot be reinstated afterwards.'
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
          label="Reason"
          htmlFor="vendor-reason"
          required
          hint="Somebody will ask why this supplier stopped being used, possibly years later."
        >
          <Textarea
            id="vendor-reason"
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
          submitLabel={action === 'suspend' ? 'Suspend' : 'Terminate'}
          variant="danger"
        />
      </form>
    </Modal>
  );
}
