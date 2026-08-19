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
  Select,
  Textarea,
  humanizeStatus,
} from '@/shared/ui';
import { CRITICALITIES } from './vendor.types';
import { useCriticalityLevels } from './use-vendors';

/**
 * Putting a supplier on the register.
 *
 * CRITICALITY IS NOT A LABEL, it is a schedule: the level carries the review interval and whether
 * independent evidence is required, both read from the API's reference table and shown where the choice is
 * made. Choosing `critical` commits somebody to assessing it that often.
 */

export function RegisterVendorModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const levels = useCriticalityLevels();
  const [form, setForm] = useState({
    reference: '',
    name: '',
    legalName: '',
    services: '',
    criticality: 'medium' as (typeof CRITICALITIES)[number],
    ownerId: '',
    dataProcessor: false,
    dataLocation: '',
    contractStartsOn: '',
    contractEndsOn: '',
    noticePeriodDays: '',
  });
  const [error, setError] = useState('');

  const level = levels.data?.find((entry) => entry.code === form.criticality);

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/vendors', {
        body: {
          reference: form.reference,
          name: form.name,
          legalName: form.legalName || null,
          services: form.services,
          criticality: form.criticality,
          ownerId: form.ownerId,
          dataProcessor: form.dataProcessor,
          dataLocation: form.dataLocation || null,
          contractStartsOn: form.contractStartsOn || null,
          contractEndsOn: form.contractEndsOn || null,
          noticePeriodDays: form.noticePeriodDays ? Number(form.noticePeriodDays) : null,
        },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to register the supplier.'));
    },
    onSuccess: () => {
      toast.success('Supplier registered');
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
      title="Register a supplier"
      description="Registered as PROSPECTIVE. Activating one is a separate decision, and a separate permission."
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
          <FormField label="Reference" htmlFor="vendor-reference" required>
            <Input
              id="vendor-reference"
              required
              value={form.reference}
              onChange={(e) => set('reference', e.target.value.toUpperCase())}
              placeholder="SUP-2026-014"
            />
          </FormField>
          <FormField label="Criticality" htmlFor="vendor-criticality" required>
            <Select
              id="vendor-criticality"
              value={form.criticality}
              onChange={(e) => set('criticality', e.target.value as typeof form.criticality)}
            >
              {CRITICALITIES.map((code) => (
                <option key={code} value={code}>
                  {levels.data?.find((entry) => entry.code === code)?.label ?? humanizeStatus(code)}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        {/* The schedule the choice commits to, from the reference table rather than restated here. */}
        {level && (
          <p className="-mt-2 text-xs text-fg-subtle">
            {level.description} Reassessed every {level.reviewIntervalMonths} months
            {level.requiresIndependentEvidence ? ', and independent evidence is required.' : '.'}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Name" htmlFor="vendor-name" required>
            <Input
              id="vendor-name"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Acme Cloud"
            />
          </FormField>
          <FormField
            label="Legal name"
            htmlFor="vendor-legal"
            hint="If it differs from the trading name."
          >
            <Input
              id="vendor-legal"
              value={form.legalName}
              onChange={(e) => set('legalName', e.target.value)}
            />
          </FormField>
        </div>

        <FormField
          label="Services"
          htmlFor="vendor-services"
          required
          hint="What they do for us. This is what a continuity plan is written against."
        >
          <Textarea
            id="vendor-services"
            required
            rows={2}
            value={form.services}
            onChange={(e) => set('services', e.target.value)}
          />
        </FormField>

        <FormField label="Owner" htmlFor="vendor-owner" required>
          <EntityPicker
            id="vendor-owner"
            queryKey="active-employees"
            value={form.ownerId}
            onChange={(value) => set('ownerId', value)}
            fetchOptions={activeEmployeeOptions}
            placeholder="Search people…"
          />
        </FormField>

        <div className="grid grid-cols-3 gap-3">
          <FormField label="Contract starts" htmlFor="vendor-start">
            <Input
              id="vendor-start"
              type="date"
              value={form.contractStartsOn}
              onChange={(e) => set('contractStartsOn', e.target.value)}
            />
          </FormField>
          <FormField label="Contract ends" htmlFor="vendor-end">
            <Input
              id="vendor-end"
              type="date"
              value={form.contractEndsOn}
              onChange={(e) => set('contractEndsOn', e.target.value)}
            />
          </FormField>
          <FormField label="Notice (days)" htmlFor="vendor-notice">
            <Input
              id="vendor-notice"
              type="number"
              min={0}
              value={form.noticePeriodDays}
              onChange={(e) => set('noticePeriodDays', e.target.value)}
            />
          </FormField>
        </div>

        <label className="flex cursor-pointer select-none items-start gap-2.5">
          <input
            type="checkbox"
            checked={form.dataProcessor}
            onChange={(e) => set('dataProcessor', e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border-strong text-accent focus:ring-accent"
          />
          <span className="text-sm text-fg-muted">
            Processes personal data on our behalf
            <span className="block text-xs text-fg-subtle">
              Makes them a processor under GDPR Article 28, which needs a data-processing agreement.
            </span>
          </span>
        </label>

        {form.dataProcessor && (
          <FormField
            label="Where the data is held"
            htmlFor="vendor-data-location"
            hint="The transfer question follows from this."
          >
            <Input
              id="vendor-data-location"
              value={form.dataLocation}
              onChange={(e) => set('dataLocation', e.target.value)}
              placeholder="EU (Frankfurt)"
            />
          </FormField>
        )}

        <FormError message={error} />

        <FormActions
          loading={mutation.isPending}
          onClose={onClose}
          submitLabel="Register supplier"
        />
      </form>
    </Modal>
  );
}
