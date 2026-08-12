import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import {
  FormActions,
  FormField,
  Input,
  Modal,
  Select,
  Textarea,
  humanizeStatus,
} from '@/shared/ui';
import { BREACH_NOTIFICATION_HOURS, SEVERITIES } from './incident.types';

/**
 * Report an incident.
 *
 * REPORTING NEEDS NO PERMISSION, deliberately: anybody who notices something must be able to raise it,
 * and `incident.manage` governs the handling. So this form is the one part of the screen that is never
 * gated, and the action stays on the page for every reader.
 *
 * `detectedAt` IS WHEN SOMEBODY BECAME AWARE, not when the incident happened — and it is the input the
 * breach clock runs from, so the field says so. `datetime-local`, because the difference between 09:00
 * and 17:00 on the same day is a third of the 72 hours.
 */
export function ReportIncidentModal({
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
    severity: 'medium' as (typeof SEVERITIES)[number],
    detectedAt: '',
    personalDataBreach: false,
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/incidents/report', {
        body: {
          reference: form.reference,
          title: form.title,
          description: form.description,
          category: form.category,
          severity: form.severity,
          detectedAt: new Date(form.detectedAt).toISOString(),
          personalDataBreach: form.personalDataBreach,
        },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to report the incident.'));
    },
    onSuccess: () => {
      toast.success('Incident reported');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <Modal open={open} onClose={onClose} title="Report an incident">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Reference" htmlFor="incident-reference" required>
            <Input
              id="incident-reference"
              required
              value={form.reference}
              onChange={(e) => set('reference', e.target.value.toUpperCase())}
              placeholder="INC-2026-014"
            />
          </FormField>
          <FormField label="Category" htmlFor="incident-category" required>
            <Input
              id="incident-category"
              required
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              placeholder="Phishing"
            />
          </FormField>
        </div>

        <FormField label="Title" htmlFor="incident-title" required>
          <Input
            id="incident-title"
            required
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Credential-harvesting email opened by two people in Finance"
          />
        </FormField>

        <FormField
          label="What happened"
          htmlFor="incident-description"
          required
          hint="Written for somebody reading it cold, weeks later, possibly a regulator."
        >
          <Textarea
            id="incident-description"
            required
            rows={4}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Severity" htmlFor="incident-severity" required>
            <Select
              id="incident-severity"
              value={form.severity}
              onChange={(e) => set('severity', e.target.value as typeof form.severity)}
            >
              {SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {humanizeStatus(severity)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="Detected at"
            htmlFor="incident-detected"
            required
            hint="When somebody became AWARE. The breach clock runs from this."
          >
            <Input
              id="incident-detected"
              type="datetime-local"
              required
              value={form.detectedAt}
              onChange={(e) => set('detectedAt', e.target.value)}
            />
          </FormField>
        </div>

        {/* A real checkbox with a real label, because this one flag starts a legal deadline. */}
        <label className="flex cursor-pointer select-none items-start gap-2.5">
          <input
            type="checkbox"
            checked={form.personalDataBreach}
            onChange={(e) => set('personalDataBreach', e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border-strong text-accent focus:ring-accent"
          />
          <span className="text-sm text-fg-muted">
            Personal data was or may have been exposed
            <span className="block text-xs text-fg-subtle">
              Starts the {BREACH_NOTIFICATION_HOURS}-hour notification clock (GDPR Article 33). The
              deadline is computed by the API from the detection time.
            </span>
          </span>
        </label>

        {error && <p className="text-xs text-danger">{error}</p>}

        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Report incident" />
      </form>
    </Modal>
  );
}
