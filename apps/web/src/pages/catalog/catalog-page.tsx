import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Clock, Package } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { Button, FormField, Modal, PageHeader, Textarea, humanizeStatus } from '@/shared/ui';
import type { components } from '@/shared/api/types';

type CatalogItem = components['schemas']['CatalogItemResponseDto'];

/*
 * WHAT THIS SCREEN NO LONGER CARRIES
 *
 * A hand-written `CatalogItem` interface and raw `sessionFetch` calls — the same pattern finops had,
 * and the routes have been in the generated client all along. A `CATEGORY_LABEL` map whose values were
 * emoji-prefixed strings (`'🖥 Hardware'`), so the emoji was data rather than presentation and a
 * category the map did not know rendered as a bare slug. And its own `SuccessToast` component — a
 * fixed-position box with a dismiss button — in an app that mounts `sonner` and uses `toast()`
 * everywhere else.
 *
 * The minimum-length rule on the reason was enforced only by disabling the button, which tells
 * somebody who has typed three characters nothing about why they cannot continue.
 */

/** Emoji per category, as PRESENTATION. The label itself comes from `humanizeStatus`. */
const CATEGORY_EMOJI: Record<string, string> = {
  hardware: '🖥',
  software: '💿',
  access: '🔑',
  hr: '👤',
  other: '📋',
};

const MIN_REASON = 10;
const MAX_REASON = 1000;

function useCatalogItems() {
  return useQuery({
    queryKey: ['catalog', 'items'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/catalog');
      if (error || !data) throw new Error('Failed to load the catalog');
      return data;
    },
  });
}

function RequestModal({
  item,
  onClose,
  onSuccess,
}: {
  item: CatalogItem;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: err } = await api.POST('/v1/catalog/{id}/request', {
        params: { path: { id: item.id } },
        body: { reason },
      });
      if (err) throw new Error('Failed to submit the request');
    },
    onSuccess,
    onError: (err: Error) => setError(err.message),
  });

  const tooShort = reason.trim().length < MIN_REASON;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Request ${item.name}`}
      description={item.slaHours ? `Fulfilled within ${item.slaHours}h once approved` : undefined}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // Stated rather than silently disabled: a greyed-out button tells somebody who typed three
          // characters nothing about why they cannot continue.
          if (tooShort) {
            setError(`Please give at least ${MIN_REASON} characters of context.`);
            return;
          }
          setError('');
          mutation.mutate();
        }}
        className="flex flex-col gap-4 p-5"
      >
        {item.description && <p className="text-sm text-fg-muted">{item.description}</p>}

        <FormField
          label="Why do you need this?"
          htmlFor="catalog-reason"
          required
          error={error}
          hint={`${reason.trim().length} / ${MAX_REASON} characters`}
        >
          <Textarea
            id="catalog-reason"
            rows={4}
            maxLength={MAX_REASON}
            value={reason}
            error={error}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What is it for, and when do you need it?"
          />
        </FormField>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={mutation.isPending}>
            {mutation.isPending ? 'Submitting…' : 'Submit request'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** One requestable item. A `<button>` because the whole card is the action. */
function ItemCard({ item, onRequest }: { item: CatalogItem; onRequest: (i: CatalogItem) => void }) {
  return (
    <button
      type="button"
      onClick={() => onRequest(item)}
      className="group flex h-full flex-col gap-2 rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xl" aria-hidden="true">
          {item.iconEmoji ?? CATEGORY_EMOJI[item.category] ?? '📋'}
        </span>
        <ChevronRight
          className="h-4 w-4 shrink-0 text-fg-subtle transition-colors group-hover:text-fg-muted"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{item.name}</p>
        {item.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{item.description}</p>
        )}
      </div>
      {item.slaHours && (
        <span className="inline-flex items-center gap-1 text-xs text-fg-subtle">
          <Clock className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
          {item.slaHours}h SLA
        </span>
      )}
    </button>
  );
}

export function CatalogPage() {
  const qc = useQueryClient();
  const { data: items, isLoading, isError } = useCatalogItems();
  const [requesting, setRequesting] = useState<CatalogItem | null>(null);

  const rows = items ?? [];
  const categories = [...new Set(rows.map((i) => i.category))].sort();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Service Catalog"
        description="Request hardware, software, access and more. Every item has an owner and an SLA."
      />

      {isLoading && <p className="py-10 text-center text-sm text-fg-subtle">Loading…</p>}
      {isError && (
        <p className="py-10 text-center text-sm text-danger">Failed to load the catalog.</p>
      )}

      {!isLoading && !isError && rows.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12">
          <Package className="h-8 w-8 text-fg-subtle" strokeWidth={1.5} />
          <span className="text-sm text-fg-subtle">Nothing in the catalog yet</span>
        </div>
      )}

      {categories.map((category) => (
        <section key={category} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-fg">
            <span className="mr-1.5" aria-hidden="true">
              {CATEGORY_EMOJI[category] ?? '📋'}
            </span>
            {humanizeStatus(category)}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rows
              .filter((i) => i.category === category)
              .map((item) => (
                <ItemCard key={item.id} item={item} onRequest={setRequesting} />
              ))}
          </div>
        </section>
      ))}

      {requesting && (
        <RequestModal
          item={requesting}
          onClose={() => setRequesting(null)}
          onSuccess={() => {
            void qc.invalidateQueries({ queryKey: ['requests'] });
            // The app's own toaster, not a bespoke box: one place decides how a success looks.
            toast.success('Request submitted', {
              description: `"${requesting.name}" — you will be notified when it is approved.`,
            });
            setRequesting(null);
          }}
        />
      )}
    </div>
  );
}
