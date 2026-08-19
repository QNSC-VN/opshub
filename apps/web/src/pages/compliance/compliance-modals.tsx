import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import type { SoftwareListing } from '@/shared/api/types';
import { Button, FormActions, FormError, FormField, Modal, Select, Textarea } from '@/shared/ui';

/**
 * Resolving a compliance finding.
 *
 * Extracted from `compliance-page.tsx` when the file-size ratchet refused it at 498 lines — the same
 * reason `reports/` became three modules. A page is composition; a form with its own state, its own
 * mutation and its own submit path is a component, and every other screen in this migration keeps its
 * dialogs in a sibling `*-modals.tsx`. Moving it is what the convention already said to do.
 *
 * RISK ACCEPTED is a resolution, not a separate action: the API records the same transition with a flag,
 * so one dialog covers both and the toast says which one happened.
 */

interface ResolveModalProps {
  findingId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ResolveModal({ findingId, open, onClose, onSuccess }: ResolveModalProps) {
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState('');
  const [riskAccepted, setRiskAccepted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await api.POST('/v1/compliance/findings/{id}/resolve', {
      params: { path: { id: findingId } },
      body: { note: note || undefined, riskAccepted },
    });
    setLoading(false);
    if (error) {
      toast.error(apiErrorMessage(error, 'Failed to resolve finding.'));
      return;
    }
    toast.success(riskAccepted ? 'Finding marked as risk accepted' : 'Finding resolved');
    onSuccess();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Resolve finding" size="sm">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
        <FormField label="Resolution note" htmlFor="resolve-note">
          <Textarea
            id="resolve-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Describe how this finding was addressed…"
          />
        </FormField>

        <label className="flex cursor-pointer select-none items-center gap-2.5">
          <input
            type="checkbox"
            checked={riskAccepted}
            onChange={(e) => setRiskAccepted(e.target.checked)}
            className="h-4 w-4 rounded border-border-strong text-accent focus:ring-accent"
          />
          <span className="text-sm text-fg-muted">
            Accept residual risk (mark as risk accepted)
          </span>
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={loading}>
            {loading ? 'Saving…' : 'Resolve'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Changing a software entry's listing — the decision the catalogue exists to record.
 *
 * WHY THE NOTE SITS WITH THE LISTING. `PATCH /v1/compliance/software/{id}` takes both, and offering the
 * listing alone would make "why is this banned" a separate act nobody performs. Six months on, a blacklist
 * entry with no reason is one somebody quietly reverses; the shadow-IT scan that flagged the software is not
 * itself an explanation.
 *
 * PRE-FILLED FROM THE ROW, including the existing note, so a listing change does not silently blank a reason
 * somebody wrote. The API treats an omitted field as unchanged, but sending the note back unchanged is
 * clearer than relying on that and leaves the textarea honest about what is stored.
 */
interface ReclassifySoftwareModalProps {
  entry: { id: string; name: string; listing: string; notes: string | null };
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * The three values `software_listing` actually has.
 *
 * `unknown — seen, not yet assessed` was a fourth option, and choosing it FAILED THE SAVE: the enum
 * has no such value, so the API refused the write. "Not yet assessed" is what `review` already means,
 * which is also the column's default.
 */
const LISTING_OPTIONS: { value: SoftwareListing; label: string }[] = [
  { value: 'whitelisted', label: 'Whitelisted — allowed on managed devices' },
  { value: 'blacklisted', label: 'Blacklisted — must not be installed' },
  { value: 'review', label: 'Review — a decision is pending' },
];

export function ReclassifySoftwareModal({
  entry,
  onClose,
  onSuccess,
}: ReclassifySoftwareModalProps) {
  const [loading, setLoading] = useState(false);
  const [listing, setListing] = useState(entry.listing);
  const [notes, setNotes] = useState(entry.notes ?? '');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error: err } = await api.PATCH('/v1/compliance/software/{id}', {
      params: { path: { id: entry.id } },
      // `notes` is nullable at the API: an emptied box means "no reason recorded", not "leave the old one".
      body: { listing: listing as never, notes: notes.trim() || null },
    });
    setLoading(false);
    if (err) {
      setError(apiErrorMessage(err, 'Failed to update the listing.'));
      return;
    }
    toast.success(`${entry.name} is now ${listing}`);
    onSuccess();
    onClose();
  }

  return (
    <Modal open onClose={onClose} size="sm" title={`Reclassify ${entry.name}`}>
      <form onSubmit={submit} className="flex flex-col gap-4 p-5">
        <FormField label="Listing" htmlFor="software-listing" required>
          <Select
            id="software-listing"
            value={listing}
            onChange={(e) => setListing(e.target.value)}
          >
            {LISTING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField
          label="Why"
          htmlFor="software-notes"
          hint="The reason the next person reads. Empty records no reason at all."
        >
          <Textarea
            id="software-notes"
            rows={3}
            value={notes}
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
          />
        </FormField>

        <FormError message={error} />

        <FormActions loading={loading} onClose={onClose} submitLabel="Save listing" />
      </form>
    </Modal>
  );
}
