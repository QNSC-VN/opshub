import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { Button, FormError, FormField, Input, Modal } from '@/shared/ui';
import { cn } from '@/shared/lib/utils';
import { ALL_EVENTS, type EventType } from './webhook.types';

/**
 * Subscribe an endpoint to events.
 *
 * The event list is real CHECKBOXES inside labels, as in the onboarding wizard: the `<button>` version
 * had no checked state to announce, so a screen reader could not report which events were selected.
 *
 * The secret is `type="password"` and never read back — the API stores a bcrypt hash, so there is
 * nothing to show again even if a field existed for it. Stated in the hint rather than left as a
 * surprise at the second visit.
 */
export function CreateSubscriptionModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<EventType[]>([]);
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error: err } = await api.POST('/v1/webhooks/subscriptions', {
        body: { url, secret, description: description || undefined, events },
      });
      if (err || !data) throw new Error('Failed to create the subscription');
      return data;
    },
    onSuccess: () => {
      toast.success('Subscription created');
      onSuccess();
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  function toggleEvent(event: EventType) {
    setEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="New webhook subscription">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (events.length === 0) {
            setError('Choose at least one event — a subscription to nothing delivers nothing.');
            return;
          }
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <FormField label="Endpoint URL" htmlFor="wh-url" required>
          <Input
            id="wh-url"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/hooks/opshub"
          />
        </FormField>

        <FormField
          label="Signing secret"
          htmlFor="wh-secret"
          required
          hint="At least 16 characters. Stored as a bcrypt hash, so it cannot be shown again — keep your own copy."
        >
          <Input
            id="wh-secret"
            type="password"
            required
            minLength={16}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        </FormField>

        <FormField label="Description" htmlFor="wh-description">
          <Input
            id="wh-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Production alert channel…"
          />
        </FormField>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-xs font-medium text-fg-muted">
            Events <span className="text-danger">*</span>
          </legend>
          {ALL_EVENTS.map((event) => {
            const checked = events.includes(event);
            return (
              <label
                key={event}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 font-mono text-xs transition-colors',
                  'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40',
                  checked
                    ? 'border-accent bg-accent/5 text-fg'
                    : 'border-border bg-surface text-fg-muted hover:bg-surface-hover',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleEvent(event)}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    checked ? 'border-accent bg-accent' : 'border-border',
                  )}
                >
                  {checked && <Check className="h-3 w-3 text-white" />}
                </span>
                {event}
              </label>
            );
          })}
        </fieldset>

        <FormError message={error} />

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create subscription'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
