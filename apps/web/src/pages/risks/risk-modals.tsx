import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import { activeEmployeeOptions } from '@/shared/api/picker-sources';
import {
  EntityPicker,
  FormActions,
  FormField,
  Input,
  Modal,
  Select,
  Textarea,
  humanizeStatus,
} from '@/shared/ui';
import { MatrixFields } from './risk-matrix';
import { TREATMENT_DECISIONS, type Risk } from './risk.types';

/**
 * Identifying and assessing a risk — the two forms that set its factors.
 *
 * Split from the EXITS (`risk-exit-modals.tsx`: accept, close) and from the treatment plan when this file
 * passed the size ceiling. The seam is the one the domain already has: these two describe the risk, the
 * others decide what happens about it.
 */

/** Identify a new risk: what it is, whose it is, and how bad it is before anything is done. */
export function IdentifyRiskModal({
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
    description: '',
    category: '',
    ownerId: '',
    likelihood: '',
    impact: '',
    reviewDueOn: '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/risks', {
        body: {
          reference: form.reference,
          title: form.title,
          description: form.description,
          category: form.category,
          ownerId: form.ownerId,
          inherent: { likelihood: Number(form.likelihood), impact: Number(form.impact) },
          reviewDueOn: form.reviewDueOn || null,
        },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to record the risk.'));
    },
    onSuccess: () => {
      toast.success('Risk recorded');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <Modal open={open} onClose={onClose} title="Identify a risk">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Reference"
            htmlFor="risk-reference"
            required
            hint="Quoted in the register and in audit evidence."
          >
            <Input
              id="risk-reference"
              required
              value={form.reference}
              onChange={(e) => set('reference', e.target.value.toUpperCase())}
              placeholder="R-2026-014"
            />
          </FormField>
          <FormField label="Category" htmlFor="risk-category" required>
            <Input
              id="risk-category"
              required
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              placeholder="Access control"
            />
          </FormField>
        </div>

        <FormField label="Title" htmlFor="risk-title" required>
          <Input
            id="risk-title"
            required
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Shared admin credentials for the billing console"
          />
        </FormField>

        <FormField
          label="Description"
          htmlFor="risk-description"
          required
          hint="What could happen, to what, and how. The register is read by people who were not in the room."
        >
          <Textarea
            id="risk-description"
            required
            rows={4}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </FormField>

        <FormField
          label="Owner"
          htmlFor="risk-owner"
          required
          hint="Accountable for treating it, and named on the acceptance if it is carried."
        >
          <EntityPicker
            id="risk-owner"
            queryKey="active-employees"
            value={form.ownerId}
            onChange={(value) => set('ownerId', value)}
            fetchOptions={activeEmployeeOptions}
            placeholder="Search people…"
          />
        </FormField>

        <MatrixFields
          idPrefix="risk-inherent"
          likelihood={form.likelihood}
          impact={form.impact}
          onLikelihood={(value) => set('likelihood', value)}
          onImpact={(value) => set('impact', value)}
          hint="before any control"
        />

        <FormField label="Review due" htmlFor="risk-review-due">
          <Input
            id="risk-review-due"
            type="date"
            value={form.reviewDueOn}
            onChange={(e) => set('reviewDueOn', e.target.value)}
          />
        </FormField>

        {error && <p className="text-xs text-danger">{error}</p>}

        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Record risk" />
      </form>
    </Modal>
  );
}

/**
 * Assess a risk: the decision, and what is left after it.
 *
 * RESIDUAL CANNOT BE WORSE THAN INHERENT — a database CHECK, restated as a coded refusal, and not
 * pre-empted here: a form that clamped the selects would hide the rule rather than teach it, and the
 * refusal names the two numbers.
 */
export function AssessRiskModal({
  risk,
  onClose,
  onSuccess,
}: {
  risk: Risk;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [decision, setDecision] = useState<(typeof TREATMENT_DECISIONS)[number]>('mitigate');
  const [likelihood, setLikelihood] = useState(String(risk.residualLikelihood ?? ''));
  const [impact, setImpact] = useState(String(risk.residualImpact ?? ''));
  const [reviewDueOn, setReviewDueOn] = useState(risk.reviewDueOn ?? '');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/risks/{id}/assess', {
        params: { path: { id: risk.id } },
        body: {
          decision,
          residual: { likelihood: Number(likelihood), impact: Number(impact) },
          reviewDueOn: reviewDueOn || null,
        },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to assess the risk.'));
    },
    onSuccess: () => {
      toast.success('Risk assessed');
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
      title={`Assess ${risk.reference}`}
      description={`Inherent score ${risk.inherentScore ?? '—'}. The residual is what remains after the decision below.`}
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
          label="Decision"
          htmlFor="assess-decision"
          required
          hint="Mitigate with controls, accept the exposure, transfer it, or avoid the activity."
        >
          <Select
            id="assess-decision"
            value={decision}
            onChange={(e) => setDecision(e.target.value as typeof decision)}
          >
            {TREATMENT_DECISIONS.map((option) => (
              <option key={option} value={option}>
                {humanizeStatus(option)}
              </option>
            ))}
          </Select>
        </FormField>

        <MatrixFields
          idPrefix="assess-residual"
          likelihood={likelihood}
          impact={impact}
          onLikelihood={setLikelihood}
          onImpact={setImpact}
          hint="after the decision — never worse than inherent"
        />

        <FormField label="Review due" htmlFor="assess-review-due">
          <Input
            id="assess-review-due"
            type="date"
            value={reviewDueOn}
            onChange={(e) => setReviewDueOn(e.target.value)}
          />
        </FormField>

        {error && <p className="text-xs text-danger">{error}</p>}

        <FormActions
          loading={mutation.isPending}
          onClose={onClose}
          submitLabel="Record assessment"
        />
      </form>
    </Modal>
  );
}
