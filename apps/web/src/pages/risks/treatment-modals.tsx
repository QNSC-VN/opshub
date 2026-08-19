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
import type { Risk } from './risk.types';

/**
 * The treatment plan: what will actually be done about a risk.
 *
 * A risk cannot be marked TREATED while any action is outstanding — a count across rows, so no CHECK can
 * see it and the service enforces it. The panel that lists these shows how many remain.
 */

/** Add a treatment action: what will be done, by whom, by when. */
export function AddTreatmentModal({
  risk,
  onClose,
  onSuccess,
}: {
  risk: Risk;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [description, setDescription] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/risks/{id}/treatments', {
        params: { path: { id: risk.id } },
        body: { description, ownerId, dueOn: dueOn || null },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to add the treatment action.'));
    },
    onSuccess: () => {
      toast.success('Treatment action added');
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
      title="Add a treatment action"
      description="The risk cannot be marked treated while any action is still outstanding."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <FormField label="Action" htmlFor="treatment-description" required>
          <Textarea
            id="treatment-description"
            required
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Move the billing console behind SSO and remove the shared account"
          />
        </FormField>
        <FormField label="Owner" htmlFor="treatment-owner" required>
          <EntityPicker
            id="treatment-owner"
            queryKey="active-employees"
            value={ownerId}
            onChange={setOwnerId}
            fetchOptions={activeEmployeeOptions}
            placeholder="Search people…"
          />
        </FormField>
        <FormField label="Due" htmlFor="treatment-due">
          <Input
            id="treatment-due"
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
          />
        </FormField>

        <FormError message={error} />

        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Add action" />
      </form>
    </Modal>
  );
}
