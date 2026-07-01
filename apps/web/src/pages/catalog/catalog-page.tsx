import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, X, Check, Clock, Package } from 'lucide-react';
import { getToken } from '@/shared/api/auth-store';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CatalogItem {
  id: string;
  name: string;
  description: string | null;
  category: string;
  iconEmoji: string | null;
  approvalPermission: string;
  slaHours: number | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
}

function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${getToken() ?? ''}` };
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useCatalogItems() {
  return useQuery({
    queryKey: ['catalog', 'items'],
    queryFn: async () => {
      const res = await fetch('/v1/catalog', { headers: authHeader() });
      if (!res.ok) throw new Error('Failed to load catalog');
      return res.json() as Promise<CatalogItem[]>;
    },
  });
}

// ── Request Modal ─────────────────────────────────────────────────────────────

interface RequestModalProps {
  item: CatalogItem;
  onClose: () => void;
  onSuccess: () => void;
}

function RequestModal({ item, onClose, onSuccess }: RequestModalProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/v1/catalog/${item.id}/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? 'Failed to submit request');
      }
      return res.json() as Promise<{ requestId: string }>;
    },
    onSuccess: () => { onSuccess(); onClose(); },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">{item.iconEmoji ?? '📋'}</span>
            <h2 className="text-sm font-semibold text-fg">{item.name}</h2>
          </div>
          <button onClick={onClose} className="rounded p-1 text-fg-subtle hover:bg-surface-hover">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {item.description && (
            <p className="text-sm text-fg-subtle">{item.description}</p>
          )}
          {item.slaHours && (
            <div className="flex items-center gap-1.5 text-xs text-fg-muted">
              <Clock className="h-3.5 w-3.5" />
              Fulfilled within {item.slaHours}h
            </div>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-subtle">
              Reason / details <span className="text-danger">*</span>
            </label>
            <textarea
              rows={4}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 resize-none"
              placeholder="Describe what you need and why…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="mt-1 text-xs text-fg-muted">{reason.length} / 1000 chars (min 10)</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-fg-subtle hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            disabled={reason.length < 10 || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {mutation.isPending ? 'Submitting…' : 'Submit request'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Success Toast ─────────────────────────────────────────────────────────────

function SuccessToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-success-bg bg-surface px-4 py-3 shadow-lg">
      <Check className="h-4 w-4 text-success" />
      <p className="text-sm text-fg">{message}</p>
      <button onClick={onDismiss} className="ml-2 text-fg-subtle hover:text-fg">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Catalog Item Card ─────────────────────────────────────────────────────────

function ItemCard({ item, onRequest }: { item: CatalogItem; onRequest: (item: CatalogItem) => void }) {
  return (
    <button
      onClick={() => onRequest(item)}
      className="group flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 text-left hover:border-accent/50 hover:bg-surface-hover transition-colors"
    >
      <div className="flex items-start justify-between">
        <span className="text-2xl">{item.iconEmoji ?? '📋'}</span>
        <ChevronRight className="h-4 w-4 text-fg-muted opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <div>
        <p className="text-sm font-semibold text-fg">{item.name}</p>
        {item.description && (
          <p className="mt-1 line-clamp-2 text-xs text-fg-subtle">{item.description}</p>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-fg-muted">
        <span className="capitalize">{item.category}</span>
        {item.slaHours && (
          <>
            <span>·</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {item.slaHours}h SLA
            </span>
          </>
        )}
      </div>
    </button>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<string, string> = {
  hardware: '🖥 Hardware',
  software: '💿 Software',
  access: '🔑 Access',
  hr: '👤 HR',
  other: '📋 Other',
};

export function CatalogPage() {
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useCatalogItems();
  const [requesting, setRequesting] = useState<CatalogItem | null>(null);
  const [successMsg, setSuccessMsg] = useState('');

  // Group by category
  const categories = [...new Set(items.map((i) => i.category))].sort();

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="sticky top-0 z-10 border-b border-border bg-app px-6 py-3">
        <h1 className="text-base font-semibold text-fg">Service Catalog</h1>
        <p className="text-xs text-fg-subtle">Request hardware, software, access, and more from IT</p>
      </div>

      <div className="p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-fg-muted">Loading catalog…</p>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Package className="mb-3 h-10 w-10 text-fg-muted/40" />
            <p className="text-sm font-medium text-fg">No catalog items yet</p>
            <p className="mt-1 text-xs text-fg-muted">Ask your IT administrator to set up the service catalog.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {categories.map((cat) => {
              const catItems = items.filter((i) => i.category === cat);
              return (
                <section key={cat}>
                  <h2 className="mb-3 text-sm font-semibold text-fg">
                    {CATEGORY_LABEL[cat] ?? cat}
                  </h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {catItems.map((item) => (
                      <ItemCard key={item.id} item={item} onRequest={setRequesting} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {requesting && (
        <RequestModal
          item={requesting}
          onClose={() => setRequesting(null)}
          onSuccess={() => {
            void qc.invalidateQueries({ queryKey: ['requests'] });
            setSuccessMsg(`Request submitted for "${requesting.name}". You'll be notified when it's approved.`);
            setRequesting(null);
          }}
        />
      )}

      {successMsg && (
        <SuccessToast
          message={successMsg}
          onDismiss={() => setSuccessMsg('')}
        />
      )}
    </div>
  );
}
