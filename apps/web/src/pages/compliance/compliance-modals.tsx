import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import { Button, FormField, Modal, Textarea } from '@/shared/ui';

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
