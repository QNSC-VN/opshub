import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import { activeEmployeeOptions } from '@/shared/api/picker-sources';
import {
  EntityPicker,
  FormActions,
  FormField,
  Input,
  Modal,
  Select,
  Textarea,
  humanizeStatus,
} from '@/shared/ui';
import { CONTROL_THEMES, SOA_STATUSES, type Control, type SoaRow } from './control.types';

/** Add a control the standard does not carry. */
export function CreateControlModal({
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
    theme: 'organizational' as (typeof CONTROL_THEMES)[number],
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/controls', {
        body: {
          reference: form.reference,
          title: form.title,
          description: form.description || null,
          theme: form.theme,
          // `custom` is the only honest source for a control created here — `annex_a` belongs to the
          // catalogue the seed loads, and claiming it would put a local control in the standard.
          source: 'custom',
        },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to create the control.'));
    },
    onSuccess: () => {
      toast.success('Control created');
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
      title="New control"
      description="Recorded as a CUSTOM control. The Annex A catalogue comes from the standard and is not edited here."
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
          <FormField label="Reference" htmlFor="control-reference" required>
            <Input
              id="control-reference"
              required
              value={form.reference}
              onChange={(e) => set('reference', e.target.value.toUpperCase())}
              placeholder="LOCAL-01"
            />
          </FormField>
          <FormField label="Theme" htmlFor="control-theme" required>
            <Select
              id="control-theme"
              value={form.theme}
              onChange={(e) => set('theme', e.target.value as typeof form.theme)}
            >
              {CONTROL_THEMES.map((theme) => (
                <option key={theme} value={theme}>
                  {humanizeStatus(theme)}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <FormField label="Title" htmlFor="control-title" required>
          <Input
            id="control-title"
            required
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Quarterly access review of the billing console"
          />
        </FormField>

        <FormField label="Description" htmlFor="control-description">
          <Textarea
            id="control-description"
            rows={3}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </FormField>

        {error && <p className="text-xs text-danger">{error}</p>}

        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Create control" />
      </form>
    </Modal>
  );
}

/**
 * Decide a control's place in the Statement of Applicability.
 *
 * THE JUSTIFICATION IS REQUIRED EITHER WAY. Including a control needs a reason and so does excluding one
 * — an SoA whose exclusions say nothing is the classic audit finding, and the API makes no distinction
 * between the two directions. The hint changes with the choice so the field says what it is for.
 *
 * `applicable` and `status` are separate because they answer different questions: whether the control is
 * in scope, and how far it has been implemented. `not_applicable` as a status is what an exclusion looks
 * like, which is why choosing it flips `applicable` too rather than leaving the two to disagree.
 */
export function SetSoaEntryModal({
  control,
  entry,
  onClose,
  onSuccess,
}: {
  control: { id: string; reference: string; title: string };
  /** The current entry, when the control has already been decided. */
  entry: SoaRow | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [status, setStatus] = useState<(typeof SOA_STATUSES)[number]>(
    (entry?.status as (typeof SOA_STATUSES)[number]) ?? 'not_implemented',
  );
  const [justification, setJustification] = useState(entry?.justification ?? '');
  const [implementationNote, setImplementationNote] = useState(entry?.implementationNote ?? '');
  const [ownerId, setOwnerId] = useState(entry?.ownerId ?? '');
  const [reviewDueOn, setReviewDueOn] = useState(entry?.reviewDueOn ?? '');
  const [error, setError] = useState('');

  const excluded = status === 'not_applicable';

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.PUT('/v1/controls/soa/{controlId}', {
        params: { path: { controlId: control.id } },
        body: {
          // Kept in step with the status rather than offered as a second switch somebody can contradict.
          applicable: !excluded,
          justification,
          status,
          implementationNote: implementationNote || null,
          ownerId: ownerId || null,
          reviewDueOn: reviewDueOn || null,
        },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to save the SoA entry.'));
    },
    onSuccess: () => {
      toast.success('Statement of Applicability updated');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`${control.reference} — ${control.title}`}
      description="Every control is either in scope with a status, or excluded with a reason. Both are decisions an auditor reads."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <FormField label="Status" htmlFor="soa-status" required>
          <Select
            id="soa-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            {SOA_STATUSES.map((option) => (
              <option key={option} value={option}>
                {option === 'not_applicable' ? 'Excluded (not applicable)' : humanizeStatus(option)}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField
          label="Justification"
          htmlFor="soa-justification"
          required
          hint={
            excluded
              ? 'Why this control does not apply here. An exclusion with no reason is the finding auditors look for first.'
              : 'Why this control is in scope — usually the risk it answers.'
          }
        >
          <Textarea
            id="soa-justification"
            required
            rows={3}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
          />
        </FormField>

        {/* An implementation note on an excluded control would describe implementing something that does
            not apply, so the field goes away with the decision. */}
        {!excluded && (
          <>
            <FormField
              label="Implementation note"
              htmlFor="soa-note"
              hint="How it is done here, and where the evidence lives."
            >
              <Textarea
                id="soa-note"
                rows={3}
                value={implementationNote}
                onChange={(e) => setImplementationNote(e.target.value)}
              />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Owner" htmlFor="soa-owner">
                <EntityPicker
                  id="soa-owner"
                  queryKey="active-employees"
                  value={ownerId}
                  onChange={setOwnerId}
                  fetchOptions={activeEmployeeOptions}
                  placeholder="Search people…"
                />
              </FormField>
              <FormField
                label="Review due"
                htmlFor="soa-review-due"
                hint="A control nobody revisits is a control nobody knows still works."
              >
                <Input
                  id="soa-review-due"
                  type="date"
                  value={reviewDueOn}
                  onChange={(e) => setReviewDueOn(e.target.value)}
                />
              </FormField>
            </div>
          </>
        )}

        {error && <p className="text-xs text-danger">{error}</p>}

        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Save entry" />
      </form>
    </Modal>
  );
}

/** The bit of a control the catalogue lets you change: everything except its reference. */
export function EditControlModal({
  control,
  onClose,
  onSuccess,
}: {
  control: Control;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [title, setTitle] = useState(control.title);
  const [description, setDescription] = useState(control.description ?? '');
  const [theme, setTheme] = useState(control.theme as (typeof CONTROL_THEMES)[number]);
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.PATCH('/v1/controls/{id}', {
        params: { path: { id: control.id } },
        body: { title, description: description || null, theme },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to update the control.'));
    },
    onSuccess: () => {
      toast.success('Control updated');
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
      title={`Edit ${control.reference}`}
      description="The reference is immutable: it is quoted by SoA entries, risks and audit evidence."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <FormField label="Title" htmlFor="edit-control-title" required>
          <Input
            id="edit-control-title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </FormField>
        <FormField label="Theme" htmlFor="edit-control-theme" required>
          <Select
            id="edit-control-theme"
            value={theme}
            onChange={(e) => setTheme(e.target.value as typeof theme)}
          >
            {CONTROL_THEMES.map((option) => (
              <option key={option} value={option}>
                {humanizeStatus(option)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Description" htmlFor="edit-control-description">
          <Textarea
            id="edit-control-description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>

        {error && <p className="text-xs text-danger">{error}</p>}

        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Save control" />
      </form>
    </Modal>
  );
}
