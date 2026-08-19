import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import { activeEmployeeOptions } from '@/shared/api/picker-sources';
import { isoInstantFromDate, todayIso } from '@/shared/lib/format';
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
import { NC_SEVERITIES, NC_SOURCES, type Nonconformance } from './quality.types';
import { useSeverities } from './use-quality';

/**
 * The four things somebody does to a finding: raise it, contain it, close it, void it.
 *
 * NONE OF THESE FORMS RE-DECIDES WHETHER THE MOVE IS LEGAL. The service holds the transition map and a
 * guarded `WHERE status = <from>`, so two people closing the same finding is Postgres's call. What these
 * forms do is collect the evidence the transition requires and name the rule at the point of decision,
 * because a refusal a reader could have predicted is a refusal the screen should have explained first.
 */

/**
 * Raising a finding.
 *
 * THE GRADE IS A COMMITMENT, NOT A LABEL. Each grade carries `requiresCapa` and `containmentDueDays` from
 * `qms.nonconformance_severities`, so choosing `major` over `minor` may commit somebody to a CAPA verified
 * effective before this can ever close, and sets the containment deadline. Both consequences are shown next
 * to the choice, read from the API's own reference data.
 */
export function RaiseNonconformanceModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const severities = useSeverities();
  const [form, setForm] = useState({
    reference: '',
    title: '',
    description: '',
    requirement: '',
    source: 'internal_audit' as (typeof NC_SOURCES)[number],
    severity: 'minor' as (typeof NC_SEVERITIES)[number],
    processArea: '',
    ownerId: '',
    detectedAt: todayIso(),
  });
  const [error, setError] = useState('');

  const grade = severities.data?.find((entry) => entry.code === form.severity);

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/nonconformances/report', {
        body: {
          reference: form.reference,
          title: form.title,
          description: form.description,
          requirement: form.requirement,
          source: form.source,
          severity: form.severity,
          processArea: form.processArea,
          ownerId: form.ownerId,
          // The column is `timestamptz`; a bare date is rejected.
          detectedAt: form.detectedAt ? isoInstantFromDate(form.detectedAt) : undefined,
        },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to raise the finding.'));
    },
    onSuccess: () => {
      toast.success('Finding raised');
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
      title="Raise a non-conformance"
      description="Raised as OPEN. Containment comes before closure, so a finding cannot go straight to closed."
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
          <FormField label="Reference" htmlFor="nc-reference" required>
            <Input
              id="nc-reference"
              required
              value={form.reference}
              onChange={(e) => set('reference', e.target.value.toUpperCase())}
              placeholder="NC-2026-041"
            />
          </FormField>
          <FormField label="Detected on" htmlFor="nc-detected" required>
            <Input
              id="nc-detected"
              type="date"
              required
              max={todayIso()}
              value={form.detectedAt}
              onChange={(e) => set('detectedAt', e.target.value)}
            />
          </FormField>
        </div>

        <FormField label="Title" htmlFor="nc-title" required>
          <Input
            id="nc-title"
            required
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Release deployed without a recorded approval"
          />
        </FormField>

        <FormField
          label="Requirement"
          htmlFor="nc-requirement"
          required
          hint="The clause, procedure or spec the finding is against — what makes it a non-conformance rather than an opinion."
        >
          <Input
            id="nc-requirement"
            required
            value={form.requirement}
            onChange={(e) => set('requirement', e.target.value)}
            placeholder="ISO 9001:2015 §8.5.6 / SOP-DEV-004 §3.2"
          />
        </FormField>

        <FormField label="Description" htmlFor="nc-description" required>
          <Textarea
            id="nc-description"
            required
            rows={3}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="What was found, where, and against what evidence."
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Source" htmlFor="nc-source" required>
            <Select
              id="nc-source"
              value={form.source}
              onChange={(e) => set('source', e.target.value as typeof form.source)}
            >
              {NC_SOURCES.map((code) => (
                <option key={code} value={code}>
                  {humanizeStatus(code)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Severity" htmlFor="nc-severity" required>
            <Select
              id="nc-severity"
              value={form.severity}
              onChange={(e) => set('severity', e.target.value as typeof form.severity)}
            >
              {NC_SEVERITIES.map((code) => (
                <option key={code} value={code}>
                  {severities.data?.find((entry) => entry.code === code)?.label ??
                    humanizeStatus(code)}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        {/* The grade's two consequences, from the API's reference table, stated where the grade is chosen. */}
        {grade && (
          <p className="text-xs text-fg-subtle">
            {grade.requiresCapa
              ? 'This grade cannot be closed until a CAPA on it is verified effective.'
              : 'This grade can be closed on containment alone, with no CAPA.'}{' '}
            Containment is due within {grade.containmentDueDays} day(s) of detection.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Process area" htmlFor="nc-process-area" required>
            <Input
              id="nc-process-area"
              required
              value={form.processArea}
              onChange={(e) => set('processArea', e.target.value)}
              placeholder="Software delivery"
            />
          </FormField>
          <FormField
            label="Owner"
            htmlFor="nc-owner"
            required
            hint="Answerable for containing and closing it."
          >
            <EntityPicker
              id="nc-owner"
              value={form.ownerId}
              onChange={(value) => set('ownerId', value)}
              queryKey="active-employees"
              fetchOptions={activeEmployeeOptions}
              placeholder="Search employees…"
            />
          </FormField>
        </div>

        <FormError message={error} />
        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Raise finding" />
      </form>
    </Modal>
  );
}

/**
 * Containment.
 *
 * WHAT CONTAINMENT IS FOR: stopping the bleeding, not fixing the cause. ISO 9001 §10.2(a) asks for action
 * to control and correct the non-conformity itself, which is a different question from why it happened —
 * that one is the CAPA's. Keeping them separate is why `open → closed` is not a legal move.
 */
export function ContainNonconformanceModal({
  finding,
  onClose,
  onSuccess,
}: {
  finding: Nonconformance;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [containmentAction, setContainmentAction] = useState('');
  const [containedAt, setContainedAt] = useState(todayIso());
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/nonconformances/{id}/contain', {
        params: { path: { id: finding.id } },
        body: {
          containmentAction,
          containedAt: containedAt ? isoInstantFromDate(containedAt) : undefined,
        },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to record containment.'));
    },
    onSuccess: () => {
      toast.success('Containment recorded');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Contain ${finding.reference}`}
      description="Immediate action taken to control the non-conformity. The root cause is the CAPA's job, not this one's."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <FormField label="Containment action" htmlFor="nc-containment" required>
          <Textarea
            id="nc-containment"
            required
            rows={3}
            value={containmentAction}
            onChange={(e) => setContainmentAction(e.target.value)}
            placeholder="What was done to stop the non-conformity continuing, and to correct what it affected."
          />
        </FormField>

        {/* Bounded at BOTH ends by rules the API holds: containment cannot predate detection, and it
            cannot be in the future. Stating the floor here means the picker cannot offer the refusal. */}
        <FormField label="Contained on" htmlFor="nc-contained-at" required>
          <Input
            id="nc-contained-at"
            type="date"
            required
            min={finding.detectedAt.slice(0, 10)}
            max={todayIso()}
            value={containedAt}
            onChange={(e) => setContainedAt(e.target.value)}
          />
        </FormField>

        {/* Said here because containment is the moment the closure requirement becomes actionable. */}
        {finding.requiresCapa && (
          <p className="text-xs text-fg-subtle">
            A {humanizeStatus(finding.severity).toLowerCase()} finding still needs a CAPA verified
            effective before it can close.
          </p>
        )}

        <FormError message={error} />
        <FormActions
          loading={mutation.isPending}
          onClose={onClose}
          submitLabel="Record containment"
        />
      </form>
    </Modal>
  );
}
