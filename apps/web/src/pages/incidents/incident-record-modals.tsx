import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import {
  FormActions,
  FormError,
  FormField,
  Input,
  Modal,
  Select,
  Textarea,
  humanizeStatus,
} from '@/shared/ui';
import { EVENT_TYPES, type Incident } from './incident.types';

/**
 * The off-ramp and the record: dismissing something that was not an incident, and appending to the
 * timeline.
 *
 * Both keep everything. A dismissal stays in the register with its reason — that is what stops the same
 * alert being re-reported next week — and the timeline is APPEND-ONLY, which is what makes it evidence
 * rather than notes.
 */

/** Dismiss as a false positive — only reachable before containment, and it needs a reason. */
export function DismissIncidentModal({
  incident,
  onClose,
  onSuccess,
}: {
  incident: Incident;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/incidents/{id}/dismiss', {
        params: { path: { id: incident.id } },
        body: { reason },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to dismiss the incident.'));
    },
    onSuccess: () => {
      toast.success('Recorded as a false positive');
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
      title={`Dismiss ${incident.reference}`}
      description="Recorded as a false positive. The report stays in the register — dismissing is not deleting."
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
          label="Why it was not an incident"
          htmlFor="dismiss-reason"
          required
          hint="Somebody thought it was. The reason is what stops the same thing being re-reported."
        >
          <Textarea
            id="dismiss-reason"
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
          submitLabel="Dismiss"
          variant="danger"
        />
      </form>
    </Modal>
  );
}

/** Add a note or a piece of evidence to the timeline. `status_change` is the API's to write, not ours. */
export function AddTimelineEntryModal({
  incident,
  onClose,
  onSuccess,
}: {
  incident: Incident;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [type, setType] = useState<(typeof EVENT_TYPES)[number]>('note');
  const [detail, setDetail] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/incidents/{id}/timeline', {
        params: { path: { id: incident.id } },
        body: {
          type,
          detail,
          occurredAt: occurredAt ? new Date(occurredAt).toISOString() : undefined,
        },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to add the timeline entry.'));
    },
    onSuccess: () => {
      toast.success('Timeline entry added');
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
      title="Add to the timeline"
      description="Append-only. Entries cannot be edited or removed, which is what makes the timeline evidence."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <FormField label="Type" htmlFor="event-type" required>
          <Select
            id="event-type"
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
          >
            {EVENT_TYPES.map((option) => (
              <option key={option} value={option}>
                {humanizeStatus(option)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Detail" htmlFor="event-detail" required>
          <Textarea
            id="event-detail"
            required
            rows={3}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="Mailbox rule removed; forwarding to the external address stopped."
          />
        </FormField>
        <FormField label="Occurred at" htmlFor="event-at" hint="Leave empty for now.">
          <Input
            id="event-at"
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
          />
        </FormField>

        <FormError message={error} />

        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Add entry" />
      </form>
    </Modal>
  );
}
