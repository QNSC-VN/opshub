import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import { activeEmployeeOptions } from '@/shared/api/picker-sources';
import {
  EntityPicker,
  FormActions,
  FormError,
  FormField,
  Input,
  Modal,
  Textarea,
} from '@/shared/ui';
import type { Incident } from './incident.types';

/**
 * Moving an incident FORWARD: triage, contain, resolve, close.
 *
 * EACH FORM ASKS FOR WHAT THAT STATE REQUIRES, and nothing else — triage names an owner, resolving needs
 * a root cause, closing needs the lesson. Those are the database's "NOT NULL when in this state" CHECKs,
 * restated as coded refusals in the service, so the form asks rather than letting a save fail on a rule it
 * never mentioned.
 *
 * TIMESTAMPS ARE OPTIONAL and left empty on purpose: the API stamps `now()` when the field is absent.
 * Offering it covers the case that actually happens — recording on Monday what was contained on Saturday.
 */

/** Triage: give it an owner. That is the whole step, and it is why the form has one field. */
export function TriageIncidentModal({
  incident,
  onClose,
  onSuccess,
}: {
  incident: Incident;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [assignedTo, setAssignedTo] = useState(incident.assignedTo ?? '');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/incidents/{id}/triage', {
        params: { path: { id: incident.id } },
        body: { assignedTo },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to triage the incident.'));
    },
    onSuccess: () => {
      toast.success('Incident triaged');
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
      title={`Triage ${incident.reference}`}
      description="An incident with no owner is an incident nobody is working on."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <FormField label="Assign to" htmlFor="triage-assignee" required>
          <EntityPicker
            id="triage-assignee"
            queryKey="active-employees"
            value={assignedTo}
            onChange={setAssignedTo}
            fetchOptions={activeEmployeeOptions}
            placeholder="Search people…"
          />
        </FormField>

        <FormError message={error} />

        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Triage" />
      </form>
    </Modal>
  );
}

/** Contain: the bleeding stopped, and when. */
export function ContainIncidentModal({
  incident,
  onClose,
  onSuccess,
}: {
  incident: Incident;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [containedAt, setContainedAt] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/incidents/{id}/contain', {
        params: { path: { id: incident.id } },
        body: { containedAt: containedAt ? new Date(containedAt).toISOString() : undefined },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to record containment.'));
    },
    onSuccess: () => {
      toast.success('Incident contained');
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
      title={`Contain ${incident.reference}`}
      description="After this it cannot be dismissed as a false positive: containment is evidence it was real."
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
          label="Contained at"
          htmlFor="contain-at"
          hint="Leave empty for now. Set it when recording something that happened earlier."
        >
          <Input
            id="contain-at"
            type="datetime-local"
            value={containedAt}
            onChange={(e) => setContainedAt(e.target.value)}
          />
        </FormField>

        <FormError message={error} />

        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Mark contained" />
      </form>
    </Modal>
  );
}

/** Resolve: the root cause, which is the field an audit reads first. */
export function ResolveIncidentModal({
  incident,
  onClose,
  onSuccess,
}: {
  incident: Incident;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [rootCause, setRootCause] = useState('');
  const [resolvedAt, setResolvedAt] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/incidents/{id}/resolve', {
        params: { path: { id: incident.id } },
        body: {
          rootCause,
          resolvedAt: resolvedAt ? new Date(resolvedAt).toISOString() : undefined,
        },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to resolve the incident.'));
    },
    onSuccess: () => {
      toast.success('Incident resolved');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal open onClose={onClose} title={`Resolve ${incident.reference}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <FormField
          label="Root cause"
          htmlFor="resolve-cause"
          required
          hint="Why it happened, not what was done about it. A resolution with no cause cannot prevent the next one."
        >
          <Textarea
            id="resolve-cause"
            required
            rows={4}
            value={rootCause}
            onChange={(e) => setRootCause(e.target.value)}
          />
        </FormField>
        <FormField label="Resolved at" htmlFor="resolve-at" hint="Leave empty for now.">
          <Input
            id="resolve-at"
            type="datetime-local"
            value={resolvedAt}
            onChange={(e) => setResolvedAt(e.target.value)}
          />
        </FormField>

        <FormError message={error} />

        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Resolve" />
      </form>
    </Modal>
  );
}

/** Close: the lesson. This is the field the whole ISMS loop exists to produce. */
export function CloseIncidentModal({
  incident,
  onClose,
  onSuccess,
}: {
  incident: Incident;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [lessonsLearned, setLessonsLearned] = useState('');
  const [closedAt, setClosedAt] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/incidents/{id}/close', {
        params: { path: { id: incident.id } },
        body: {
          lessonsLearned,
          closedAt: closedAt ? new Date(closedAt).toISOString() : undefined,
        },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to close the incident.'));
    },
    onSuccess: () => {
      toast.success('Incident closed');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Close ${incident.reference}`}
      description="Closing is what turns an incident into something the organisation learned."
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
          label="Lessons learned"
          htmlFor="close-lessons"
          required
          hint="What changes because this happened — a control, a process, a training gap."
        >
          <Textarea
            id="close-lessons"
            required
            rows={4}
            value={lessonsLearned}
            onChange={(e) => setLessonsLearned(e.target.value)}
          />
        </FormField>
        <FormField label="Closed at" htmlFor="close-at" hint="Leave empty for now.">
          <Input
            id="close-at"
            type="datetime-local"
            value={closedAt}
            onChange={(e) => setClosedAt(e.target.value)}
          />
        </FormField>

        <FormError message={error} />

        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Close incident" />
      </form>
    </Modal>
  );
}
