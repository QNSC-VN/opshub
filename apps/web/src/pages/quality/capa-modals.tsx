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
import { ROOT_CAUSE_METHODS, type Capa } from './quality.types';

/**
 * The CAPA lifecycle, one form per step that needs evidence.
 *
 * analysis → planned → in_progress → implemented → verified, with `ineffective` sending it BACK to
 * analysis. The service owns that map and a guarded `WHERE status = <from>`; these forms collect what each
 * step requires. The steps that require NOTHING — accepting the plan, starting work, reopening the analysis —
 * have no form at all and are buttons in `CapaActions`, because a modal there would be a dialogue with one
 * possible answer.
 */

/** Opening a CAPA against a finding. Ownership and a due date are the whole commitment at this point. */
export function OpenCapaModal({
  nonconformanceId,
  nonconformanceReference,
  onClose,
  onSuccess,
}: {
  nonconformanceId: string;
  nonconformanceReference: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    reference: '',
    ownerId: '',
    dueOn: isoDaysFromNow(30),
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/capas/for/{nonconformanceId}', {
        params: { path: { nonconformanceId } },
        body: {
          reference: form.reference,
          ownerId: form.ownerId,
          dueOn: form.dueOn || null,
        },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to open the CAPA.'));
    },
    onSuccess: () => {
      toast.success('CAPA opened');
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
      title={`Open a CAPA on ${nonconformanceReference}`}
      description="Opens in ANALYSIS. The root cause comes next — a CAPA with a plan and no analysis is a task with a deadline."
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
          <FormField label="Reference" htmlFor="capa-reference" required>
            <Input
              id="capa-reference"
              required
              value={form.reference}
              onChange={(e) => set('reference', e.target.value.toUpperCase())}
              placeholder="CAPA-2026-018"
            />
          </FormField>
          <FormField label="Due on" htmlFor="capa-due-on">
            <Input
              id="capa-due-on"
              type="date"
              value={form.dueOn}
              onChange={(e) => set('dueOn', e.target.value)}
            />
          </FormField>
        </div>

        <FormField
          label="Owner"
          htmlFor="capa-owner"
          required
          hint="Answerable for the analysis and the actions — not necessarily the finding's owner."
        >
          <EntityPicker
            id="capa-owner"
            value={form.ownerId}
            onChange={(value) => set('ownerId', value)}
            queryKey="active-employees"
            fetchOptions={activeEmployeeOptions}
            placeholder="Search employees…"
          />
        </FormField>

        <FormError message={error} />
        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Open CAPA" />
      </form>
    </Modal>
  );
}

/**
 * Recording the root cause and the plan.
 *
 * A NAMED METHOD IS WHAT SEPARATES ANALYSIS FROM A GUESS. The API takes an enum, not free text, so "we
 * think it was training" cannot pass itself off as five whys. The same form serves the first analysis and
 * the re-analysis after an ineffective outcome, because they are the same act — and the second time is
 * evidence the first root cause was not the root cause.
 */
export function CapaAnalysisModal({
  capa,
  onClose,
  onSuccess,
}: {
  capa: Capa;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    rootCause: capa.rootCause ?? '',
    rootCauseMethod: (capa.rootCauseMethod ?? 'five_whys') as (typeof ROOT_CAUSE_METHODS)[number],
    actionPlan: capa.actionPlan ?? '',
    dueOn: capa.dueOn ?? '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/capas/{id}/analysis', {
        params: { path: { id: capa.id } },
        body: {
          rootCause: form.rootCause,
          rootCauseMethod: form.rootCauseMethod,
          actionPlan: form.actionPlan,
          dueOn: form.dueOn || null,
        },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to record the analysis.'));
    },
    onSuccess: () => {
      toast.success('Analysis recorded');
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
      title={`Analysis for ${capa.reference}`}
      description={
        capa.status === 'ineffective'
          ? 'The last actions did not work, so the root cause is back open. A second analysis is evidence the first one missed.'
          : 'The cause, how it was established, and what will be done about it.'
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
        <FormField label="Root cause" htmlFor="capa-root-cause" required>
          <Textarea
            id="capa-root-cause"
            required
            rows={3}
            value={form.rootCause}
            onChange={(e) => set('rootCause', e.target.value)}
            placeholder="Why the non-conformity was possible — not what happened, which the finding already records."
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Method" htmlFor="capa-method" required>
            <Select
              id="capa-method"
              value={form.rootCauseMethod}
              onChange={(e) =>
                set('rootCauseMethod', e.target.value as typeof form.rootCauseMethod)
              }
            >
              {ROOT_CAUSE_METHODS.map((code) => (
                <option key={code} value={code}>
                  {humanizeStatus(code)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Due on" htmlFor="capa-analysis-due-on">
            <Input
              id="capa-analysis-due-on"
              type="date"
              value={form.dueOn}
              onChange={(e) => set('dueOn', e.target.value)}
            />
          </FormField>
        </div>

        <FormField
          label="Action plan"
          htmlFor="capa-action-plan"
          required
          hint="What will change so the cause cannot produce this again."
        >
          <Textarea
            id="capa-action-plan"
            required
            rows={3}
            value={form.actionPlan}
            onChange={(e) => set('actionPlan', e.target.value)}
          />
        </FormField>

        <FormError message={error} />
        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Save analysis" />
      </form>
    </Modal>
  );
}

/**
 * Verification — the step that decides whether the CAPA worked.
 *
 * THIS IS THE ONE THAT UNLOCKS CLOSURE. Verifying effective is what lets a finding whose grade
 * `requiresCapa` be closed at all, and it takes `capa.verify` rather than `capa.manage`: the person who did
 * the work is not the person who gets to say it worked. Evidence is required, because ISO 9001 §10.2(1)(d)
 * asks for a review of EFFECTIVENESS, and "done" is not effectiveness.
 */
export function VerifyCapaModal({
  capa,
  onClose,
  onSuccess,
}: {
  capa: Capa;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [effectivenessEvidence, setEffectivenessEvidence] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/capas/{id}/verify', {
        params: { path: { id: capa.id } },
        body: { effectivenessEvidence },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to verify the CAPA.'));
    },
    onSuccess: () => {
      toast.success('CAPA verified effective');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Verify ${capa.reference}`}
      description="Verified effective is terminal, and it is what allows the finding to close. Evidence, not an assertion."
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
          label="Effectiveness evidence"
          htmlFor="capa-evidence"
          required
          hint="What was measured after the actions landed, and over what period."
        >
          <Textarea
            id="capa-evidence"
            required
            rows={4}
            value={effectivenessEvidence}
            onChange={(e) => setEffectivenessEvidence(e.target.value)}
            placeholder="Zero recurrences across 42 releases since 12 June, checked against the deployment log."
          />
        </FormField>

        <FormError message={error} />
        <FormActions
          loading={mutation.isPending}
          onClose={onClose}
          submitLabel="Verify effective"
        />
      </form>
    </Modal>
  );
}
