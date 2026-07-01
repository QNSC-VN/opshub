import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, X } from "lucide-react";
import { api } from "@/shared/api/client";
import { SlideOver, SlideOverSection } from "@/shared/ui/slide-over";
import { ActivityTimeline } from "@/shared/ui/activity-timeline";
import { Badge } from "@/shared/ui/badge";
import { PhotoUploadWidget } from "@/shared/ui/photo-upload";
import type { AssetResponse } from "@/shared/api/types";

const STATUS_LABEL: Record<string, string> = {
  in_stock: "In stock",
  assigned: "Assigned",
  in_repair: "In repair",
  retired: "Retired",
  lost: "Lost",
};

const STATUS_CLASS: Record<string, string> = {
  in_stock: "bg-accent-muted text-accent",
  assigned: "bg-success-bg text-success",
  in_repair: "bg-warning-bg text-warning",
  retired: "bg-surface-muted text-fg-muted",
  lost: "bg-danger-bg text-danger",
};

function useAssets(search: string) {
  return useQuery({
    queryKey: ["assets", "list", search],
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/assets", {
        params: { query: { search: search || undefined, limit: 50 } },
      });
      if (error || !data) throw new Error("Failed to load assets");
      return data;
    },
  });
}

// ── Add Asset modal ───────────────────────────────────────────────────────────

const ASSET_TYPES = ['laptop', 'desktop', 'monitor', 'phone', 'tablet', 'peripheral', 'server', 'networking', 'other'];

interface AddAssetModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function AddAssetModal({ onClose, onSuccess }: AddAssetModalProps) {
  type AssetType = 'laptop' | 'desktop' | 'monitor' | 'phone' | 'tablet' | 'peripheral' | 'other';
  const [form, setForm] = useState({ assetTag: '', type: 'laptop' as AssetType, manufacturer: '', model: '', serialNumber: '', notes: '' });
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
    onSuccess: () => { onSuccess(); onClose(); },
    onError: (err: Error) => setError(err.message),
  });

  const inputClass = 'h-8 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-fg">Add asset</h2>
          <button onClick={onClose} className="rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg-muted"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="flex flex-col gap-4 p-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-fg-muted">Asset tag *</label>
              <input required value={form.assetTag} onChange={(e) => setForm(f => ({ ...f, assetTag: e.target.value }))} className={inputClass} placeholder="ACME-001" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-fg-muted">Type *</label>
              <select value={form.type} onChange={(e) => setForm(f => ({ ...f, type: e.target.value as AssetType }))} className={inputClass + ' cursor-pointer'}>
                {ASSET_TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-fg-muted">Manufacturer</label>
              <input value={form.manufacturer} onChange={(e) => setForm(f => ({ ...f, manufacturer: e.target.value }))} className={inputClass} placeholder="Dell" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-fg-muted">Model</label>
              <input value={form.model} onChange={(e) => setForm(f => ({ ...f, model: e.target.value }))} className={inputClass} placeholder="Latitude 5540" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Serial number</label>
            <input value={form.serialNumber} onChange={(e) => setForm(f => ({ ...f, serialNumber: e.target.value }))} className={inputClass} placeholder="SN123456" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Any notes…" className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 resize-none" />
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="h-8 rounded-md border border-border px-3.5 text-sm font-medium text-fg-muted hover:bg-surface-hover">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="h-8 rounded-md bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60">
              {mutation.isPending ? 'Creating…' : 'Create asset'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function AssetsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AssetResponse | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const assets = useAssets(search);
  const refetch = () => qc.invalidateQueries({ queryKey: ['assets'] });

  function handleSelectAsset(a: AssetResponse) {
    setSelected(a as AssetResponse);
    setPhotoUrl(null); // reset photo URL when opening new asset
  }

  return (
    <>
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-fg">Assets</h1>
          <p className="mt-0.5 text-sm text-fg-muted">Hardware inventory and lifecycle tracking.</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          Add asset
        </button>
      </div>

      {/* Search */}
      <div className="relative w-64">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" strokeWidth={1.75} />
        <input
          type="text"
          placeholder="Search tag or model..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-full rounded-md border border-border bg-surface pl-8 pr-3 text-sm text-fg placeholder:text-fg-subtle transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted">
              <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Tag</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Type</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Model</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Status</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium tracking-wide text-fg-muted">Assigned to</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {assets.isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-fg-subtle">
                  Loading...
                </td>
              </tr>
            )}
            {assets.isError && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-danger">
                  Failed to load assets. Is the API running?
                </td>
              </tr>
            )}
            {assets.data?.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-sm text-fg-subtle">No assets found</span>
                    <span className="text-xs text-fg-subtle">Add your first asset to get started</span>
                  </div>
                </td>
              </tr>
            )}
            {assets.data?.data?.map((a) => (
              <tr
                key={a.id}
                className="cursor-pointer transition-colors hover:bg-surface-hover"
                onClick={() => handleSelectAsset(a as AssetResponse)}
              >
                <td className="px-4 py-3 font-mono text-xs font-medium text-fg">{a.assetTag}</td>
                <td className="px-4 py-3 text-fg-muted capitalize">{a.type}</td>
                <td className="px-4 py-3 text-fg-muted">
                  {[a.manufacturer, a.model].filter(Boolean).join(" ") || (
                    <span className="text-fg-subtle">No model</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={[
                      "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
                      STATUS_CLASS[a.status] ?? "bg-surface-muted text-fg-muted",
                    ].join(" ")}
                  >
                    {STATUS_LABEL[a.status] ?? a.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-fg-muted">
                  {a.assignedTo ? (
                    <span className="text-fg">{String(a.assignedTo)}</span>
                  ) : (
                    <span className="text-fg-subtle">Unassigned</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {assets.data?.pageInfo && (
          <div className="border-t border-border bg-surface-muted px-4 py-2.5 text-xs text-fg-subtle">
            {assets.data.pageInfo.total} asset{assets.data.pageInfo.total !== 1 ? "s" : ""}
          </div>
        )}
      </div>
    </div>

    {/* Asset detail slide-over */}
    <SlideOver
      open={!!selected}
      onClose={() => setSelected(null)}
      title={selected?.assetTag ?? 'Asset detail'}
      description={[selected?.type, selected?.model].filter(Boolean).join(' · ')}
      width="lg"
    >
      {selected && (
        <>
          <SlideOverSection title="Photo">
            <PhotoUploadWidget
              mode="image"
              currentUrl={photoUrl}
              presignUrl={`/v1/assets/${selected.id}/photo/presign`}
              confirmUrl={`/v1/assets/${selected.id}/photo/confirm`}
              accept="image/jpeg,image/png,image/webp"
              onSuccess={(url) => { setPhotoUrl(url); refetch(); }}
              label="Upload a photo of this asset (JPEG, PNG, WebP · max 10 MB)"
            />
          </SlideOverSection>

          <div className="mx-5 h-px bg-surface-muted" />

          <SlideOverSection title="Details">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {[
                { label: 'Tag',        value: selected.assetTag },
                { label: 'Type',       value: selected.type },
                { label: 'Model',      value: selected.model ?? '—' },
                { label: 'Serial',     value: (selected as Record<string, unknown>).serialNumber as string ?? '—' },
                { label: 'Status',     value: (
                  <Badge tone={
                    selected.status === 'assigned'  ? 'green' :
                    selected.status === 'in_stock'  ? 'blue'  :
                    selected.status === 'in_repair' ? 'amber' :
                    selected.status === 'lost'      ? 'red'   : 'neutral'
                  }>
                    {STATUS_LABEL[selected.status] ?? selected.status}
                  </Badge>
                )},
                { label: 'Assigned to', value: selected.assignedTo
                  ? <span className="font-medium text-fg">{String(selected.assignedTo)}</span>
                  : <span className="text-fg-subtle">Unassigned</span>
                },
              ].map(({ label, value }) => (
                <div key={label}>
                  <dt className="text-xs text-fg-subtle">{label}</dt>
                  <dd className="mt-0.5 text-fg">{value}</dd>
                </div>
              ))}
            </dl>
          </SlideOverSection>

          <div className="mx-5 h-px bg-surface-muted" />

          <SlideOverSection title="Activity">
            <ActivityTimeline resourceId={selected.id} resourceType="asset" />
          </SlideOverSection>
        </>
      )}
    </SlideOver>

    {showAdd && (
      <AddAssetModal onClose={() => setShowAdd(false)} onSuccess={refetch} />
    )}
    </>
  );
}
