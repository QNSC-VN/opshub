import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { Button, FormField, Input, Modal, Select, Textarea, humanizeStatus } from '@/shared/ui';

/** The types the API accepts. Declared once here, used by the form and nothing else. */
const ASSET_TYPES = [
  'laptop',
  'desktop',
  'monitor',
  'phone',
  'tablet',
  'peripheral',
  'other',
] as const;

type AssetType = (typeof ASSET_TYPES)[number];

export function AddAssetModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    assetTag: '',
    type: 'laptop' as AssetType,
    manufacturer: '',
    model: '',
    serialNumber: '',
    notes: '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/assets', {
        body: {
          assetTag: form.assetTag,
          type: form.type,
          manufacturer: form.manufacturer || undefined,
          model: form.model || undefined,
          serialNumber: form.serialNumber || undefined,
          notes: form.notes || undefined,
        },
      });
      if (err) throw new Error('Failed to create asset');
    },
    onSuccess: () => {
      toast.success('Asset added');
      onSuccess();
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  return (
    <Modal open={open} onClose={onClose} title="Add asset">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Asset tag"
            htmlFor="asset-tag"
            required
            hint="The label physically on the device."
          >
            <Input
              id="asset-tag"
              required
              value={form.assetTag}
              onChange={(e) => set('assetTag', e.target.value)}
              placeholder="ACME-001"
            />
          </FormField>
          <FormField label="Type" htmlFor="asset-type">
            <Select
              id="asset-type"
              value={form.type}
              onChange={(e) => set('type', e.target.value as AssetType)}
            >
              {ASSET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanizeStatus(t)}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Manufacturer" htmlFor="asset-make">
            <Input
              id="asset-make"
              value={form.manufacturer}
              onChange={(e) => set('manufacturer', e.target.value)}
              placeholder="Dell"
            />
          </FormField>
          <FormField label="Model" htmlFor="asset-model">
            <Input
              id="asset-model"
              value={form.model}
              onChange={(e) => set('model', e.target.value)}
              placeholder="Latitude 5540"
            />
          </FormField>
        </div>

        <FormField label="Serial number" htmlFor="asset-serial">
          <Input
            id="asset-serial"
            value={form.serialNumber}
            onChange={(e) => set('serialNumber', e.target.value)}
            placeholder="SN123456"
          />
        </FormField>

        <FormField label="Notes" htmlFor="asset-notes">
          <Textarea
            id="asset-notes"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Any notes…"
          />
        </FormField>

        {error && <p className="text-xs text-danger">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={mutation.isPending}>
            {mutation.isPending ? 'Adding…' : 'Add asset'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
