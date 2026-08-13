import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import { activeEmployeeOptions } from '@/shared/api/picker-sources';
import { isoDaysFromNow } from '@/shared/lib/format';
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
import {
  DOCUMENT_CATEGORIES,
  type ControlledDocument,
  type DocumentVersion,
} from './document.types';

/**
 * The forms that move a controlled document: register one, open a draft, edit a draft, publish a version.
 *
 * SUBMITTING FOR APPROVAL HAS NO FORM. It takes nothing, because the approval belongs to `RequestEngine` —
 * the same spine the whole product approves through — and this screen's job ends at handing the draft over.
 */

/**
 * Registering a document.
 *
 * THE FIRST DRAFT IS CREATED WITH IT, in one transaction, because a document with no version is a dead end:
 * nothing to edit, submit or publish. That is the service's guarantee, which is why this form asks for the
 * body up front rather than leaving somebody on an empty record.
 */
export function RegisterDocumentModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    code: '',
    title: '',
    category: 'isms_policy' as (typeof DOCUMENT_CATEGORIES)[number],
    ownerId: '',
    body: '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/documents', {
        body: {
          code: form.code,
          title: form.title,
          category: form.category,
          ownerId: form.ownerId,
          body: form.body || undefined,
        },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to register the document.'));
    },
    onSuccess: () => {
      toast.success('Document registered with its first draft');
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
      title="Register a controlled document"
      description="Created with version 1 as a DRAFT. Nothing is in force until a version is approved and published."
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
          <FormField
            label="Code"
            htmlFor="doc-code"
            required
            hint="Quoted in audits and cited by controls, so it is uppercase and stays fixed."
          >
            <Input
              id="doc-code"
              required
              value={form.code}
              onChange={(e) => set('code', e.target.value.toUpperCase())}
              placeholder="POL-001"
            />
          </FormField>
          <FormField label="Category" htmlFor="doc-category" required>
            <Select
              id="doc-category"
              value={form.category}
              onChange={(e) => set('category', e.target.value as typeof form.category)}
            >
              {DOCUMENT_CATEGORIES.map((code) => (
                <option key={code} value={code}>
                  {humanizeStatus(code)}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <FormField label="Title" htmlFor="doc-title" required>
          <Input
            id="doc-title"
            required
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Information Security Policy"
          />
        </FormField>

        <FormField
          label="Owner"
          htmlFor="doc-owner"
          required
          hint="Accountable for keeping it current — not necessarily its author."
        >
          <EntityPicker
            id="doc-owner"
            value={form.ownerId}
            onChange={(value) => set('ownerId', value)}
            queryKey="active-employees"
            fetchOptions={activeEmployeeOptions}
            placeholder="Search employees…"
          />
        </FormField>

        <FormField
          label="Body"
          htmlFor="doc-body"
          hint="The text of version 1. It can be edited while the version is still a draft."
        >
          <Textarea
            id="doc-body"
            rows={6}
            value={form.body}
            onChange={(e) => set('body', e.target.value)}
          />
        </FormField>

        {error && <p className="text-xs text-danger">{error}</p>}
        <FormActions
          loading={mutation.isPending}
          onClose={onClose}
          submitLabel="Register document"
        />
      </form>
    </Modal>
  );
}

/**
 * Opening a new draft, or editing one that exists.
 *
 * THE SAME FORM FOR BOTH, because they are the same act: proposing the next text. What differs is where the
 * starting text comes from — a new draft opens on top of the current content, an edit opens on its own — and
 * the API endpoint. `changeSummary` is required reading for anyone who has to re-acknowledge, so it is asked
 * for at the point the change is made rather than reconstructed later.
 */
export function DraftModal({
  document,
  editing,
  onClose,
  onSuccess,
}: {
  document: ControlledDocument;
  /** The draft being edited, or `null` to open a new one on top of the current content. */
  editing: DocumentVersion | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [body, setBody] = useState(editing?.body ?? '');
  const [changeSummary, setChangeSummary] = useState(editing?.changeSummary ?? '');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        body: body || undefined,
        changeSummary: changeSummary || undefined,
      };
      const { error: err } = editing
        ? await api.PUT('/v1/documents/versions/{id}', {
            params: { path: { id: editing.id } },
            body: payload,
          })
        : await api.POST('/v1/documents/{id}/versions', {
            params: { path: { id: document.id } },
            body: payload,
          });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to save the draft.'));
    },
    onSuccess: () => {
      toast.success(editing ? 'Draft saved' : 'New draft opened');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? `Edit draft v${editing.version}` : `New draft of ${document.code}`}
      description={
        editing
          ? 'Only a draft can be edited. Once a version is published it is immutable — the next change is a new draft.'
          : 'Opens on top of the current content. The published version stays in force until this one is approved and published.'
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
        <FormField
          label="Change summary"
          htmlFor="doc-change-summary"
          hint="What changed, in the words somebody re-acknowledging needs to read."
        >
          <Input
            id="doc-change-summary"
            value={changeSummary}
            onChange={(e) => setChangeSummary(e.target.value)}
            placeholder="Added the MFA requirement for remote access."
          />
        </FormField>

        <FormField label="Body" htmlFor="doc-draft-body">
          <Textarea
            id="doc-draft-body"
            rows={10}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </FormField>

        {error && <p className="text-xs text-danger">{error}</p>}
        <FormActions
          loading={mutation.isPending}
          onClose={onClose}
          submitLabel={editing ? 'Save draft' : 'Open draft'}
        />
      </form>
    </Modal>
  );
}

/**
 * Publishing an approved version.
 *
 * THE REVIEW DATE IS THE WHOLE FORM. Publishing supersedes whatever it replaces — the database enforces the
 * order through a partial unique index, so two concurrent publishes cannot both win — and the one decision
 * left to a human is when this text has to be looked at again. It is optional in the API and offered here
 * with a default, because a policy with no review date is the one nobody revisits.
 */
export function PublishVersionModal({
  version,
  onClose,
  onSuccess,
}: {
  version: DocumentVersion;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [reviewDueOn, setReviewDueOn] = useState(isoDaysFromNow(365));
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/documents/versions/{id}/publish', {
        params: { path: { id: version.id } },
        // A plain date: `reviewDueOn` is `z.string().date()`.
        body: { reviewDueOn: reviewDueOn || undefined },
      });
      if (err) throw new Error(apiErrorMessage(err, 'Failed to publish the version.'));
    },
    onSuccess: () => {
      toast.success('Version published');
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Publish v${version.version}`}
      description="Puts this version in force and supersedes the one it replaces. Everyone who acknowledged the old version owes an acknowledgement again."
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
          label="Review due on"
          htmlFor="doc-review-due"
          hint="When this text has to be looked at again. A document with no review date is the one nobody revisits."
        >
          <Input
            id="doc-review-due"
            type="date"
            value={reviewDueOn}
            onChange={(e) => setReviewDueOn(e.target.value)}
          />
        </FormField>

        {error && <p className="text-xs text-danger">{error}</p>}
        <FormActions loading={mutation.isPending} onClose={onClose} submitLabel="Publish version" />
      </form>
    </Modal>
  );
}
