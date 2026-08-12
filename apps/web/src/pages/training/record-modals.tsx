import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import { activeEmployeeOptions, courseOptions } from '@/shared/api/picker-sources';
import { EntityPicker, FormActions, FormField, Input, Modal, Textarea } from '@/shared/ui';
import { todayIso } from '@/shared/lib/format';
import type { TrainingRecord } from './training.types';

/**
 * Record that somebody completed a course.
 *
 * `expiresOn` IS NOT A FIELD HERE. The API derives it from the course's `validityMonths` and the
 * completion date, so offering it would let somebody type a date that contradicts the course they picked
 * — and then the record and the catalogue would disagree about when a certificate lapses.
 *
 * A completion also SUPERSEDES the person's previous record for that course rather than replacing it:
 * that is the API's doing, and it is why the records table can show two rows for one person and one
 * course with only the newer one current.
 */
export function RecordCompletionModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    employeeId: '',
    courseId: '',
    completedOn: todayIso(),
    result: '',
    score: '',
    notes: '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/training/records', {
        body: {
          employeeId: form.employeeId,
          courseId: form.courseId,
          completedOn: form.completedOn,
          result: form.result || null,
          // A score is a decimal the API stores as a string; an empty box is "not scored", not zero.
          score: form.score || null,
          notes: form.notes || null,
        },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to record the completion.'));
    },
    onSuccess: () => {
      toast.success('Completion recorded');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <Modal open={open} onClose={onClose} title="Record completion" size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <FormField label="Employee" htmlFor="record-employee" required>
          <EntityPicker
            id="record-employee"
            queryKey="active-employees"
            value={form.employeeId}
            onChange={(value) => set('employeeId', value)}
            fetchOptions={activeEmployeeOptions}
            placeholder="Search people…"
          />
        </FormField>

        <FormField
          label="Course"
          htmlFor="record-course"
          required
          hint="Retired courses are not offered — a completion cannot be recorded against one."
        >
          <EntityPicker
            id="record-course"
            queryKey="courses"
            value={form.courseId}
            onChange={(value) => set('courseId', value)}
            fetchOptions={courseOptions}
            placeholder="Search courses…"
          />
        </FormField>

        <FormField
          label="Completed on"
          htmlFor="record-completed"
          required
          hint="Expiry is computed from this date and the course's validity period."
        >
          <Input
            id="record-completed"
            type="date"
            required
            value={form.completedOn}
            onChange={(e) => set('completedOn', e.target.value)}
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Result" htmlFor="record-result">
            <Input
              id="record-result"
              value={form.result}
              onChange={(e) => set('result', e.target.value)}
              placeholder="Pass"
            />
          </FormField>
          <FormField label="Score" htmlFor="record-score">
            <Input
              id="record-score"
              value={form.score}
              onChange={(e) => set('score', e.target.value)}
              placeholder="92.5"
            />
          </FormField>
        </div>

        <FormField label="Notes" htmlFor="record-notes">
          <Textarea
            id="record-notes"
            rows={2}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </FormField>

        {error && <p className="text-xs text-danger">{error}</p>}

        <FormActions
          loading={mutation.isPending}
          onClose={onClose}
          submitLabel="Record completion"
        />
      </form>
    </Modal>
  );
}

/**
 * Revoke a record, which needs a reason.
 *
 * Revocation is not a correction: it says the training does not count any more — a certificate found to
 * be forged, an accreditation withdrawn by the provider. The reason is required by the API and shown on
 * the record afterwards, because the next person to read it needs to know why a completed course stopped
 * counting.
 */
export function RevokeRecordModal({
  record,
  courseTitle,
  onClose,
  onSuccess,
}: {
  record: TrainingRecord;
  courseTitle: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/training/records/{id}/revoke', {
        params: { path: { id: record.id } },
        body: { reason },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to revoke the record.'));
    },
    onSuccess: () => {
      toast.success('Record revoked');
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
      title={`Revoke ${courseTitle}`}
      description="The record stops counting towards this person's requirements, and any gap it was closing reopens."
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
          htmlFor="revoke-reason"
          required
          hint="Required by the API, and kept on the record — a revocation nobody explained cannot be defended later."
        >
          <Textarea
            id="revoke-reason"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Certificate could not be verified with the provider…"
          />
        </FormField>

        {error && <p className="text-xs text-danger">{error}</p>}

        <FormActions
          loading={mutation.isPending}
          onClose={onClose}
          submitLabel="Revoke record"
          variant="danger"
        />
      </form>
    </Modal>
  );
}
