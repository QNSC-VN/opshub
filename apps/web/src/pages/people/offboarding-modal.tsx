import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { Button, FormField, Modal, Textarea } from '@/shared/ui';
import type { EmployeeResponse } from './people.types';

interface OffboardingModalProps {
  employee: EmployeeResponse;
  onClose: () => void;
  onSuccess: (requestId: string) => void;
}

/** Raise an offboarding request. The engine decides; this only asks. */
export function OffboardingModal({ employee, onClose, onSuccess }: OffboardingModalProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error: err } = await api.POST('/v1/workforce/offboarding', {
        body: { employeeId: employee.id, reason: reason || undefined },
      });
      if (err || !data) throw new Error('Failed to submit offboarding request');
      return data;
    },
    onSuccess: (data) => onSuccess(data.requestId),
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Modal open onClose={onClose} title={`Offboard — ${employee.displayName}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        {/* Stated before the field, not after: what this does is the decision, the reason is detail. */}
        <div className="rounded-md border border-warning/30 bg-warning-bg px-4 py-3">
          <p className="text-xs font-medium text-warning">
            This will revoke all access, return assets, and deactivate the employee once approved.
          </p>
        </div>

        <FormField label="Reason" htmlFor="offb-reason" hint="Optional.">
          <Textarea
            id="offb-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Resignation, end of contract…"
          />
        </FormField>

        {error && <p className="text-xs text-danger">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" size="sm" disabled={mutation.isPending}>
            {mutation.isPending ? 'Submitting…' : 'Offboard employee'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
