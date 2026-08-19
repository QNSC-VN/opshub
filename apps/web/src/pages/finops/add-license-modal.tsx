import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
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

const LICENSE_TYPES = ['subscription', 'per_seat', 'perpetual', 'concurrent'] as const;

/**
 * Add a licence to the catalogue.
 *
 * COST IS ENTERED IN DOLLARS AND SENT IN CENTS — the conversion is here, at the edge, because the
 * column is an integer number of cents and a float must never reach it. `Math.round` and not `|0`:
 * `12.50 * 100` is `1250.0000000000002` in binary floating point, and truncating that loses a cent.
 */
export function AddLicenseModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    vendor: '',
    licenseType: 'subscription' as (typeof LICENSE_TYPES)[number],
    seatCount: '',
    costPerSeat: '',
    renewalDate: '',
    notes: '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/licenses', {
        body: {
          name: form.name,
          vendor: form.vendor,
          licenseType: form.licenseType,
          seatCount: form.seatCount ? Number(form.seatCount) : null,
          costPerSeatCents: form.costPerSeat ? Math.round(Number(form.costPerSeat) * 100) : null,
          renewalDate: form.renewalDate || null,
          notes: form.notes || null,
        },
      });
      if (err) throw new Error('Failed to create license');
    },
    onSuccess: () => {
      toast.success('License added');
      onSuccess();
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  return (
    <Modal open={open} onClose={onClose} title="Add license">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <FormField label="Product name" htmlFor="lic-name" required>
          <Input
            id="lic-name"
            required
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Microsoft 365 Business Premium"
          />
        </FormField>

        <FormField label="Vendor" htmlFor="lic-vendor" required>
          <Input
            id="lic-vendor"
            required
            value={form.vendor}
            onChange={(e) => set('vendor', e.target.value)}
            placeholder="Microsoft"
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Type" htmlFor="lic-type">
            <Select
              id="lic-type"
              value={form.licenseType}
              onChange={(e) => set('licenseType', e.target.value as typeof form.licenseType)}
            >
              {LICENSE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanizeStatus(t)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Seats" htmlFor="lic-seats">
            <Input
              id="lic-seats"
              type="number"
              min={0}
              value={form.seatCount}
              onChange={(e) => set('seatCount', e.target.value)}
              placeholder="100"
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Cost per seat"
            htmlFor="lic-cost"
            hint="Per month, in dollars. Stored as cents."
          >
            <Input
              id="lic-cost"
              type="number"
              min={0}
              step={0.01}
              value={form.costPerSeat}
              onChange={(e) => set('costPerSeat', e.target.value)}
              placeholder="12.50"
            />
          </FormField>
          <FormField label="Renewal date" htmlFor="lic-renewal">
            <Input
              id="lic-renewal"
              type="date"
              value={form.renewalDate}
              onChange={(e) => set('renewalDate', e.target.value)}
            />
          </FormField>
        </div>

        <FormField label="Notes" htmlFor="lic-notes">
          <Textarea
            id="lic-notes"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Optional notes…"
          />
        </FormField>

        <FormError message={error} />

        <FormActions
          loading={mutation.isPending}
          onClose={onClose}
          submitLabel="Add license"
          pendingLabel="Adding…"
        />
      </form>
    </Modal>
  );
}
