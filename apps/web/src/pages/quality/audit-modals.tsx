import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import { activeEmployeeOptions, documentOptions } from '@/shared/api/picker-sources';
import { isoDaysFromNow, isoInstantFromDate, todayIso } from '@/shared/lib/format';
import { EntityPicker, FormActions, FormField, Input, Modal, Textarea } from '@/shared/ui';
import type { InternalAudit } from './audit.types';

/**
 * The forms that move an audit: plan it, start fieldwork, report results, cancel it.
 *
 * Closing takes nothing at all, so it has no form — the conclusion and the report were recorded at
 * `report`, and `closed` is the statement that the follow-up is finished. That is also why
 * `in_progress → closed` is refused: there would be nothing on the row to close ON.
 */

/**
 * Planning an audit.
 *
 * THE LEAD JOINS THE ROSTER HERE, in the same transaction. The roster is what the impartiality rule reads,
 * so a lead who was not on it would be free to certify that a fix for their own finding worked — the service
 * writes both rather than leaving it to a second call somebody forgets.
 */
export function PlanAuditModal({
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
    objective: '',
    scope: '',
    criteria: '',
    leadAuditorId: '',
    plannedStartOn: todayIso(),
    plannedEndOn: isoDaysFromNow(14),
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/internal-audits', {
        body: {
          reference: form.reference,
          title: form.title,
          objective: form.objective,
          scope: form.scope,
          criteria: form.criteria,
          leadAuditorId: form.leadAuditorId,
          plannedStartOn: form.plannedStartOn || null,
          plannedEndOn: form.plannedEndOn || null,
        },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to plan the audit.'));
    },
    onSuccess: () => {
      toast.success('Audit planned');
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
      title="Plan an internal audit"
      description="Scope, criteria and a lead auditor. The lead joins the roster immediately, which is what makes the impartiality rule work."
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
          <FormField label="Reference" htmlFor="audit-reference" required>
            <Input
              id="audit-reference"
              required
              value={form.reference}
              onChange={(e) => set('reference', e.target.value.toUpperCase())}
              placeholder="IA-2026-004"
            />
          </FormField>
          <FormField label="Title" htmlFor="audit-title" required>
            <Input
              id="audit-title"
              required
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="Change management, Q3"
            />
          </FormField>
        </div>

        <FormField
          label="Objective"
          htmlFor="audit-objective"
          required
          hint="What the audit is for — the question it exists to answer."
        >
          <Textarea
            id="audit-objective"
            required
            rows={2}
            value={form.objective}
            onChange={(e) => set('objective', e.target.value)}
          />
        </FormField>

        <FormField
          label="Scope"
          htmlFor="audit-scope"
          required
          hint="Which processes, sites and period. What is OUT is as much the scope as what is in."
        >
          <Textarea
            id="audit-scope"
            required
            rows={2}
            value={form.scope}
            onChange={(e) => set('scope', e.target.value)}
          />
        </FormField>

        <FormField
          label="Criteria"
          htmlFor="audit-criteria"
          required
          hint="What the evidence is judged against — clauses, procedures, contracts. Without criteria a finding is an opinion."
        >
          <Textarea
            id="audit-criteria"
            required
            rows={2}
            value={form.criteria}
            onChange={(e) => set('criteria', e.target.value)}
            placeholder="ISO 9001:2015 §8.5.6, SOP-DEV-004"
          />
        </FormField>

        <FormField label="Lead auditor" htmlFor="audit-lead" required>
          <EntityPicker
            id="audit-lead"
            value={form.leadAuditorId}
            onChange={(value) => set('leadAuditorId', value)}
            queryKey="active-employees"
            fetchOptions={activeEmployeeOptions}
            placeholder="Search employees…"
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Planned start" htmlFor="audit-planned-start">
            <Input
              id="audit-planned-start"
              type="date"
              value={form.plannedStartOn}
              onChange={(e) => set('plannedStartOn', e.target.value)}
            />
          </FormField>
          {/* The API refuses an end before the start, so the picker cannot offer one. */}
          <FormField label="Planned end" htmlFor="audit-planned-end">
            <Input
              id="audit-planned-end"
              type="date"
              min={form.plannedStartOn || undefined}
              value={form.plannedEndOn}
              onChange={(e) => set('plannedEndOn', e.target.value)}
            />
          </FormField>
        </div>

        {error && <p className="text-xs text-danger">{error}</p>}
        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Plan audit" />
      </form>
    </Modal>
  );
}

/**
 * Starting fieldwork.
 *
 * A DATE, AND A ROSTER THAT IS NOT EMPTY. The service refuses a start with nobody rostered — a count over
 * another table, so no CHECK can hold it — which is why this screen offers Start only once the roster has
 * somebody on it, and says so where the roster is managed rather than after the refusal.
 */
export function StartAuditModal({
  audit,
  onClose,
  onSuccess,
}: {
  audit: InternalAudit;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [startedAt, setStartedAt] = useState(todayIso());
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/internal-audits/{id}/start', {
        params: { path: { id: audit.id } },
        body: { startedAt: startedAt ? isoInstantFromDate(startedAt) : undefined },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to start the audit.'));
    },
    onSuccess: () => {
      toast.success('Fieldwork started');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Start ${audit.reference}`}
      description="Fieldwork has begun. Findings raised from here trace to this engagement."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <FormField label="Started on" htmlFor="audit-started-at" required>
          <Input
            id="audit-started-at"
            type="date"
            required
            max={todayIso()}
            value={startedAt}
            onChange={(e) => setStartedAt(e.target.value)}
          />
        </FormField>

        {error && <p className="text-xs text-danger">{error}</p>}
        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Start fieldwork" />
      </form>
    </Modal>
  );
}

/**
 * Reporting results.
 *
 * THE STEP THAT MAKES THE AUDIT REAL. ISO 9001 §9.2.2(d) makes reporting results to relevant management its
 * own obligation, and `ck_audit_reported_pair` requires BOTH the conclusion and the report document — so an
 * audit cannot be recorded as reported on a summary alone, and cannot reach `closed` at all without going
 * through here.
 */
export function ReportAuditModal({
  audit,
  onClose,
  onSuccess,
}: {
  audit: InternalAudit;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [conclusion, setConclusion] = useState('');
  const [reportDocumentId, setReportDocumentId] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/internal-audits/{id}/report', {
        params: { path: { id: audit.id } },
        body: { conclusion, reportDocumentId },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to report the audit.'));
    },
    onSuccess: () => {
      toast.success('Results reported');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Report ${audit.reference}`}
      description="Both the conclusion and the report document are required: results that reached nobody are not results."
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
          htmlFor="audit-conclusion"
          required
          hint="What the audit concluded against its criteria — not a list of the findings, which the register already holds."
        >
          <Textarea
            id="audit-conclusion"
            required
            rows={4}
            value={conclusion}
            onChange={(e) => setConclusion(e.target.value)}
          />
        </FormField>

        <FormField
          label="Report document"
          htmlFor="audit-report-doc"
          required
          hint="The issued report, as a controlled document."
        >
          <EntityPicker
            id="audit-report-doc"
            value={reportDocumentId}
            onChange={(value) => setReportDocumentId(value)}
            queryKey="documents"
            fetchOptions={documentOptions}
            placeholder="Search documents…"
          />
        </FormField>

        {error && <p className="text-xs text-danger">{error}</p>}
        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Report results" />
      </form>
    </Modal>
  );
}

/**
 * Cancelling an audit.
 *
 * ONLY BEFORE RESULTS ARE OUT. `cancelled` is unreachable from `reported`: once results have been reported,
 * the audit happened, and the record of it is §9.2.2(f) evidence rather than something to withdraw.
 */
export function CancelAuditModal({
  audit,
  onClose,
  onSuccess,
}: {
  audit: InternalAudit;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/internal-audits/{id}/cancel', {
        params: { path: { id: audit.id } },
        body: { reason },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to cancel the audit.'));
    },
    onSuccess: () => {
      toast.success('Audit cancelled');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Cancel ${audit.reference}`}
      description="The audit stays on the programme with the reason. A cancelled audit is still a statement about what was not examined."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <FormField label="Reason" htmlFor="audit-cancel-reason" required>
          <Textarea
            id="audit-cancel-reason"
            required
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this engagement is not going ahead."
          />
        </FormField>

        {error && <p className="text-xs text-danger">{error}</p>}
        <FormActions
          loading={mutation.isPending}
          onClose={onClose}
          submitLabel="Cancel audit"
          variant="danger"
        />
      </form>
    </Modal>
  );
}
