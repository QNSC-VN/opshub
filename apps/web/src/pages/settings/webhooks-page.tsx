import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Trash2, RotateCcw, Circle, CheckCircle2 } from 'lucide-react';
import { api } from '@/shared/api/client';
import { SlideOver, SlideOverSection } from '@/shared/ui/slide-over';
import { ActivityTimeline } from '@/shared/ui/activity-timeline';
import type { components } from '@/shared/api/types';

type WebhookSub = components['schemas']['WebhookSubscriptionResponseDto'];
type WebhookDelivery = components['schemas']['WebhookDeliveryResponseDto'];

// ── Available events ──────────────────────────────────────────────────────────

const ALL_EVENTS = [
  'request.submitted',
  'request.step_approved',
  'request.approved',
  'request.rejected',
  'request.cancelled',
  'request.expired',
] as const;

type EventType = (typeof ALL_EVENTS)[number];

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useSubscriptions() {
  return useQuery({
    queryKey: ['webhooks', 'subscriptions'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/webhooks/subscriptions');
      if (error || !data) throw new Error('Failed to load webhook subscriptions');
      return data;
    },
  });
}

function useDeliveries(subId: string | null) {
  return useQuery({
    queryKey: ['webhooks', 'deliveries', subId],
    queryFn: async () => {
      if (!subId) return [];
      const { data, error } = await api.GET('/v1/webhooks/subscriptions/{id}/deliveries', {
        params: { path: { id: subId } },
      });
      if (error || !data) throw new Error('Failed to load deliveries');
      return data;
    },
    enabled: !!subId,
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EventBadge({ event }: { event: string }) {
  const colorMap: Record<string, string> = {
    'request.submitted': 'bg-accent-muted text-accent',
    'request.step_approved': 'bg-violet-bg text-violet-fg',
    'request.approved': 'bg-success-bg text-success',
    'request.rejected': 'bg-danger-bg text-danger',
    'request.cancelled': 'bg-surface-muted text-fg-muted',
    'request.expired': 'bg-warning-bg text-warning',
  };
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${colorMap[event] ?? 'bg-surface-muted text-fg-muted'}`}>
      {event}
    </span>
  );
}

function DeliveryStatusBadge({ status }: { status: string }) {
  const cls =
    status === 'delivered'
      ? 'bg-success-bg text-success'
      : status === 'pending'
      ? 'bg-surface-muted text-fg-muted'
      : 'bg-danger-bg text-danger';
  return <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

// ── Create subscription modal ─────────────────────────────────────────────────

interface CreateModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function CreateSubscriptionModal({ onClose, onSuccess }: CreateModalProps) {
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<EventType[]>([]);
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error: err } = await api.POST('/v1/webhooks/subscriptions', {
        body: {
          url,
          secret,
          description: description || undefined,
          events,
        },
      });
      if (err || !data) throw new Error('Failed to create subscription');
      return data;
    },
    onSuccess: () => { onSuccess(); onClose(); },
    onError: (err: Error) => setError(err.message),
  });

  const toggleEvent = (event: EventType) =>
    setEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );

  const inputClass =
    'h-8 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-fg">Register webhook</h2>
          <button onClick={onClose} className="rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}
          className="flex flex-col gap-4 p-5"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Endpoint URL *</label>
            <input
              type="url" required value={url}
              onChange={(e) => setUrl(e.target.value)}
              className={inputClass} placeholder="https://example.com/hooks/opshub"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Signing secret *</label>
            <input
              type="password" required value={secret}
              onChange={(e) => setSecret(e.target.value)}
              className={inputClass} placeholder="At least 16 chars — stored as bcrypt hash"
            />
            <p className="text-xs text-fg-subtle">
              Deliveries are signed with <code className="rounded bg-surface-muted px-1">X-OpsHub-Signature: sha256=…</code>
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Description <span className="text-fg-subtle">(optional)</span></label>
            <input
              type="text" value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputClass} placeholder="Production alert channel…"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Events *</label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_EVENTS.map((event) => (
                <button
                  key={event} type="button" onClick={() => toggleEvent(event)}
                  className={[
                    'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                    events.includes(event)
                      ? 'border-blue-600 bg-accent text-white'
                      : 'border-border bg-surface text-fg-muted hover:border-border-strong hover:bg-surface-hover',
                  ].join(' ')}
                >
                  {event}
                </button>
              ))}
            </div>
            {events.length === 0 && <p className="text-xs text-red-400">Select at least one event</p>}
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button" onClick={onClose}
              className="h-8 rounded-md border border-border px-3.5 text-sm font-medium text-fg-muted hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="submit" disabled={mutation.isPending || events.length === 0}
              className="h-8 rounded-md bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {mutation.isPending ? 'Registering…' : 'Register webhook'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Delivery row ──────────────────────────────────────────────────────────────

function DeliveryRow({ delivery }: { delivery: WebhookDelivery }) {
  const qc = useQueryClient();

  const retry = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST('/v1/webhooks/deliveries/{id}/retry', {
        params: { path: { id: delivery.id } },
      });
      if (error) throw new Error('Retry failed');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks', 'deliveries', delivery.subscriptionId] }),
  });

  return (
    <tr className="text-xs">
      <td className="px-4 py-2.5 font-mono text-fg-subtle">{delivery.id.slice(0, 8)}…</td>
      <td className="px-4 py-2.5"><EventBadge event={delivery.eventType} /></td>
      <td className="px-4 py-2.5"><DeliveryStatusBadge status={delivery.status} /></td>
      <td className="px-4 py-2.5 text-fg-muted">{delivery.attempts}</td>
      <td className="px-4 py-2.5 text-fg-subtle">{delivery.deliveredAt ? new Date(delivery.deliveredAt).toLocaleString() : '—'}</td>
      <td className="px-4 py-2.5 text-right">
        {delivery.status !== 'delivered' && (
          <button
            onClick={() => retry.mutate()}
            disabled={retry.isPending}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-accent hover:bg-accent-muted disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" />
            Retry
          </button>
        )}
      </td>
    </tr>
  );
}

// ── Subscription row ──────────────────────────────────────────────────────────

function SubscriptionRow({
  sub,
  onDelete,
  onSelect,
}: {
  sub: WebhookSub;
  onDelete: () => void;
  onSelect: (sub: WebhookSub) => void;
}) {
  const qc = useQueryClient();

  const toggle = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH('/v1/webhooks/subscriptions/{id}/active', {
        params: { path: { id: sub.id } },
        body: { active: !sub.active },
      });
      if (error) throw new Error('Toggle failed');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks', 'subscriptions'] }),
  });

  const del = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE('/v1/webhooks/subscriptions/{id}', {
        params: { path: { id: sub.id } },
      });
      if (error) throw new Error('Delete failed');
    },
    onSuccess: onDelete,
  });

  return (
    <tr
      className="cursor-pointer transition-colors hover:bg-surface-hover"
      onClick={() => onSelect(sub)}
    >
      <td className="px-4 py-3">
        <div className="font-mono text-sm text-fg truncate max-w-xs">{sub.url}</div>
        {sub.description && <div className="text-xs text-fg-subtle">{sub.description}</div>}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {sub.events.map((e) => <EventBadge key={e} event={e} />)}
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-fg-subtle">{new Date(sub.createdAt).toLocaleDateString()}</td>
      <td className="px-4 py-3">
        <button
          onClick={(e) => { e.stopPropagation(); toggle.mutate(); }}
          disabled={toggle.isPending}
          className="flex items-center gap-1.5 text-xs font-medium"
          title={sub.active ? 'Click to disable' : 'Click to enable'}
        >
          {sub.active ? (
            <><CheckCircle2 className="h-3.5 w-3.5 text-success" /><span className="text-success">Active</span></>
          ) : (
            <><Circle className="h-3.5 w-3.5 text-fg-subtle" /><span className="text-fg-muted">Inactive</span></>
          )}
        </button>
      </td>
      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => del.mutate()}
          disabled={del.isPending}
          className="rounded p-1 text-fg-subtle hover:bg-danger-bg hover:text-danger disabled:opacity-50"
          title="Delete subscription"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function WebhooksPage() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<WebhookSub | null>(null);

  const { data, isLoading, isError } = useSubscriptions();
  const deliveries = useDeliveries(selected?.id ?? null);
  const refetch = () => qc.invalidateQueries({ queryKey: ['webhooks', 'subscriptions'] });

  return (
    <>
      <div className="flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-fg">Webhooks</h1>
            <p className="mt-0.5 text-sm text-fg-muted">
              Receive real-time event notifications at your own HTTPS endpoints.
            </p>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            Register webhook
          </button>
        </div>

        {/* Info box */}
        <div className="rounded-lg border border-blue-100 bg-accent-muted px-4 py-3">
          <p className="text-xs text-accent">
            Each delivery is signed with <code className="rounded bg-accent-muted px-1">X-OpsHub-Signature: sha256=&lt;HMAC-SHA256&gt;</code>.
            Verify this header against your secret before processing. Retries follow exponential back-off: 1 min → 5 min → 15 min → 1 hr (max 5 attempts).
          </p>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted">
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">URL</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Events</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Created</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-fg-subtle">Loading…</td></tr>
              )}
              {isError && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-danger">Failed to load subscriptions.</td></tr>
              )}
              {data?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <span className="text-sm text-fg-subtle">No webhooks registered</span>
                      <span className="text-xs text-fg-subtle">Register one to start receiving real-time events</span>
                    </div>
                  </td>
                </tr>
              )}
              {data?.map((sub) => (
                <SubscriptionRow key={sub.id} sub={sub} onDelete={refetch} onSelect={setSelected} />
              ))}
            </tbody>
          </table>
          {data && data.length > 0 && (
            <div className="border-t border-border bg-surface-muted px-4 py-2.5 text-xs text-fg-subtle">
              {data.length} subscription{data.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>

        {creating && (
          <CreateSubscriptionModal
            onClose={() => setCreating(false)}
            onSuccess={refetch}
          />
        )}
      </div>

      {/* Subscription detail SlideOver */}
      <SlideOver
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.url ?? 'Webhook'}
        description={selected?.description ?? undefined}
        width="lg"
        headerActions={selected ? (
          <button
            onClick={() => { setSelected(null); }}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-fg-muted hover:bg-surface-hover"
          >
            Close
          </button>
        ) : undefined}
      >
        {selected && (
          <>
            <SlideOverSection title="Details">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div className="col-span-2">
                  <dt className="text-xs text-fg-subtle">URL</dt>
                  <dd className="mt-0.5 break-all font-mono text-sm text-fg">{selected.url}</dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-subtle">Status</dt>
                  <dd className="mt-0.5">
                    {selected.active ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                        <Circle className="h-3.5 w-3.5" /> Inactive
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-subtle">Registered</dt>
                  <dd className="mt-0.5 text-fg">{new Date(selected.createdAt).toLocaleDateString()}</dd>
                </div>
              </dl>
              <div className="mt-4">
                <p className="mb-2 text-xs text-fg-subtle">Subscribed events</p>
                <div className="flex flex-wrap gap-1.5">
                  {selected.events.map((e) => <EventBadge key={e} event={e} />)}
                </div>
              </div>
            </SlideOverSection>

            <div className="mx-5 h-px bg-surface-muted" />

            <SlideOverSection title="Recent deliveries">
              {deliveries.isLoading && <p className="text-xs text-fg-subtle">Loading…</p>}
              {deliveries.data?.length === 0 && <p className="text-xs text-fg-subtle">No deliveries yet.</p>}
              {deliveries.data && deliveries.data.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-surface-muted">
                        <th className="px-3 py-2 text-left font-medium text-fg-muted">ID</th>
                        <th className="px-3 py-2 text-left font-medium text-fg-muted">Event</th>
                        <th className="px-3 py-2 text-left font-medium text-fg-muted">Status</th>
                        <th className="px-3 py-2 text-left font-medium text-fg-muted">Attempts</th>
                        <th className="px-3 py-2 text-left font-medium text-fg-muted">Delivered at</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {deliveries.data.map((d) => <DeliveryRow key={d.id} delivery={d} />)}
                    </tbody>
                  </table>
                </div>
              )}
            </SlideOverSection>

            <div className="mx-5 h-px bg-surface-muted" />

            <SlideOverSection title="Activity">
              <ActivityTimeline resourceId={selected.id} resourceType="webhook" />
            </SlideOverSection>
          </>
        )}
      </SlideOver>
    </>
  );
}
