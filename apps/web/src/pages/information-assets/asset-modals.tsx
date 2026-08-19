import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import { activeEmployeeOptions } from '@/shared/api/picker-sources';
import {
  Checkbox,
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
import {
  ASSET_TYPES,
  CIA_FACTORS,
  CLASSIFICATIONS,
  type ClassificationLevel,
  type InformationAsset,
} from './asset.types';
import { useClassificationLevels } from './use-assets';

/**
 * Registering and reclassifying an information asset.
 *
 * CLASSIFYING NEEDS A REASON, at registration and at every change afterwards. The API appends a history
 * row per change, so the register answers "when did this become restricted, and who said so" rather than
 * only "what is it now" — and a reason nobody wrote is the gap that makes that history useless.
 *
 * DECLASSIFYING IS A DIFFERENT PERMISSION (`information_asset.declassify`, not `.manage`), because
 * lowering a classification removes protection. The screen sends it to a different endpoint for that
 * reason, and the caller who cannot do it does not see the option.
 */

/** The handling rules for a level, from the API's own reference table rather than restated here. */
function LevelRules({ level }: { level: ClassificationLevel | undefined }) {
  if (!level) return null;
  return (
    <p className="-mt-2 text-xs text-fg-subtle">
      {level.handlingRules}
      {level.encryptionRequired && (
        <span className="ml-1 font-medium text-warning">Encryption required.</span>
      )}
    </p>
  );
}

export function RegisterAssetModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const levels = useClassificationLevels();
  const [form, setForm] = useState({
    reference: '',
    name: '',
    description: '',
    type: 'dataset' as (typeof ASSET_TYPES)[number],
    classification: 'internal' as (typeof CLASSIFICATIONS)[number],
    classificationReason: '',
    ownerId: '',
    confidentiality: '3',
    integrity: '3',
    availability: '3',
    personalData: false,
    location: '',
    retentionMonths: '',
  });
  const [error, setError] = useState('');

  const chosenLevel = levels.data?.find((level) => level.code === form.classification);

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/information-assets', {
        body: {
          reference: form.reference,
          name: form.name,
          description: form.description || null,
          type: form.type,
          classification: form.classification,
          classificationReason: form.classificationReason,
          ownerId: form.ownerId,
          confidentiality: Number(form.confidentiality),
          integrity: Number(form.integrity),
          availability: Number(form.availability),
          personalData: form.personalData,
          location: form.location || null,
          retentionMonths: form.retentionMonths ? Number(form.retentionMonths) : null,
        },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to register the asset.'));
    },
    onSuccess: () => {
      toast.success('Information asset registered');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <Modal open={open} onClose={onClose} title="Register an information asset">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Reference" htmlFor="asset-reference" required>
            <Input
              id="asset-reference"
              required
              value={form.reference}
              onChange={(e) => set('reference', e.target.value.toUpperCase())}
              placeholder="IA-2026-014"
            />
          </FormField>
          <FormField label="Type" htmlFor="asset-type" required>
            <Select
              id="asset-type"
              value={form.type}
              onChange={(e) => set('type', e.target.value as typeof form.type)}
            >
              {ASSET_TYPES.map((type) => (
                <option key={type} value={type}>
                  {humanizeStatus(type)}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <FormField label="Name" htmlFor="asset-name" required>
          <Input
            id="asset-name"
            required
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Customer billing database"
          />
        </FormField>

        <FormField label="Classification" htmlFor="asset-classification" required>
          <Select
            id="asset-classification"
            value={form.classification}
            onChange={(e) => set('classification', e.target.value as typeof form.classification)}
          >
            {CLASSIFICATIONS.map((code) => (
              <option key={code} value={code}>
                {levels.data?.find((level) => level.code === code)?.label ?? humanizeStatus(code)}
              </option>
            ))}
          </Select>
        </FormField>
        {/* The policy's own handling rules, shown where the choice is made. */}
        <LevelRules level={chosenLevel} />

        <FormField
          label="Why this classification"
          htmlFor="asset-reason"
          required
          hint="Kept as the first entry in the asset's classification history."
        >
          <Textarea
            id="asset-reason"
            required
            rows={2}
            value={form.classificationReason}
            onChange={(e) => set('classificationReason', e.target.value)}
          />
        </FormField>

        <FormField label="Owner" htmlFor="asset-owner" required>
          <EntityPicker
            id="asset-owner"
            queryKey="active-employees"
            value={form.ownerId}
            onChange={(value) => set('ownerId', value)}
            fetchOptions={activeEmployeeOptions}
            placeholder="Search people…"
          />
        </FormField>

        {/* THREE RATINGS, NOT ONE SCORE. A public dataset can still be availability-critical, and
            combining them would throw away exactly that distinction. */}
        <fieldset className="grid grid-cols-3 gap-3">
          <legend className="mb-1.5 text-xs font-medium text-fg-muted">
            Confidentiality · integrity · availability (1–5)
          </legend>
          {(['confidentiality', 'integrity', 'availability'] as const).map((field) => (
            <FormField
              key={field}
              label={humanizeStatus(field)}
              htmlFor={`asset-${field}`}
              required
            >
              <Select
                id={`asset-${field}`}
                value={form[field]}
                onChange={(e) => set(field, e.target.value)}
              >
                {CIA_FACTORS.map((factor) => (
                  <option key={factor} value={factor}>
                    {factor}
                  </option>
                ))}
              </Select>
            </FormField>
          ))}
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Location" htmlFor="asset-location" hint="Where it lives.">
            <Input
              id="asset-location"
              value={form.location}
              onChange={(e) => set('location', e.target.value)}
              placeholder="eu-west-1 / RDS"
            />
          </FormField>
          <FormField
            label="Retention (months)"
            htmlFor="asset-retention"
            hint="Empty means no retention period recorded."
          >
            <Input
              id="asset-retention"
              type="number"
              min={1}
              value={form.retentionMonths}
              onChange={(e) => set('retentionMonths', e.target.value)}
            />
          </FormField>
        </div>

        <Checkbox
          align="start"
          checked={form.personalData}
          onChange={(value) => set('personalData', value)}
          label="Holds personal data"
          hint="Brings it into the GDPR register, and into the breach assessment when an incident touches it."
        />

        <FormError message={error} />

        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Register asset" />
      </form>
    </Modal>
  );
}

/**
 * Change an asset's classification — up or down.
 *
 * DIRECTION DECIDES THE ENDPOINT, and therefore the permission. Raising a classification is `manage`;
 * LOWERING it is `information_asset.declassify`, because taking protection away is the act worth
 * separating. The dialog says which one it is about to do, computed from the levels' own ranks rather
 * than from a list of "downgrades" written here.
 */
export function ReclassifyAssetModal({
  asset,
  onClose,
  onSuccess,
}: {
  asset: InformationAsset;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const levels = useClassificationLevels();
  const [classification, setClassification] = useState(asset.classification);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const currentRank = levels.data?.find((level) => level.code === asset.classification)?.rank ?? 0;
  const nextLevel = levels.data?.find((level) => level.code === classification);
  const isDowngrade = (nextLevel?.rank ?? 0) < currentRank;

  const mutation = useMutation({
    mutationFn: async () => {
      // Same body either way; the ENDPOINT is what carries the meaning and the permission.
      const path = isDowngrade
        ? '/v1/information-assets/{id}/declassify'
        : '/v1/information-assets/{id}/reclassify';
      const { error: err } = await api.POST(path, {
        params: { path: { id: asset.id } },
        body: { classification: classification as never, reason },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to change the classification.'));
    },
    onSuccess: () => {
      toast.success(isDowngrade ? 'Asset declassified' : 'Asset reclassified');
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
      title={`Reclassify ${asset.reference}`}
      description={
        isDowngrade
          ? 'LOWERING a classification removes protection, so it needs the declassify permission and stays in the history.'
          : 'The change and its reason are appended to the asset’s classification history.'
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <FormField label="New classification" htmlFor="reclassify-level" required>
          <Select
            id="reclassify-level"
            value={classification}
            onChange={(e) => setClassification(e.target.value)}
          >
            {CLASSIFICATIONS.map((code) => (
              <option key={code} value={code}>
                {levels.data?.find((level) => level.code === code)?.label ?? humanizeStatus(code)}
              </option>
            ))}
          </Select>
        </FormField>
        <LevelRules level={nextLevel} />

        <FormField
          label="Reason"
          htmlFor="reclassify-reason"
          required
          hint="What changed about the asset or its use. This is the entry an auditor reads."
        >
          <Textarea
            id="reclassify-reason"
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
          submitLabel={isDowngrade ? 'Declassify' : 'Reclassify'}
          variant={isDowngrade ? 'danger' : 'primary'}
        />
      </form>
    </Modal>
  );
}
