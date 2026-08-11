import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop, Plus } from 'lucide-react';
import { api } from '@/shared/api/client';
import {
  Button,
  DataTable,
  EntityDetailPanel,
  ListPage,
  FileUploadWidget,
  SlideOverSection,
  StatusBadge,
  humanizeStatus,
  statusTone,
  type DataTableColumn,
} from '@/shared/ui';
import { useListState } from '@/shared/hooks/use-list-state';
import { formatDate } from '@/shared/lib/format';
import { AddAssetModal } from './add-asset-modal';
import type { AssetResponse } from '@/shared/api/types';

/*
 * WHAT THIS SCREEN NO LONGER CARRIES
 *
 * A `STATUS_LABEL` and a `STATUS_CLASS` map — the second of which coloured `in_stock` with the accent
 * tone while every other screen used it for "informational", and `assigned` green as though being
 * assigned were a success rather than a state. Both now come from `statusTone`/`humanizeStatus`. Plus a
 * hand-rolled dialog, an `inputClass`, five raw header cells, a `dl` grid, an inline search box, and
 * `limit: 50` with no paging.
 */

function useAssets(search: string, limit: number, offset: number) {
  return useQuery({
    queryKey: ['assets', 'list', search, limit, offset],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/assets', {
        params: { query: { search: search || undefined, limit, offset } },
      });
      if (error || !data) throw new Error('Failed to load assets');
      return data;
    },
  });
}

export function AssetsPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<AssetResponse | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const list = useListState();

  const assets = useAssets(list.search, list.limit, list.offset);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['assets'] });

  const columns: DataTableColumn<AssetResponse>[] = [
    {
      key: 'tag',
      header: 'Tag',
      cell: (a) => <span className="font-mono text-xs font-medium text-fg">{a.assetTag}</span>,
    },
    { key: 'type', header: 'Type', cell: (a) => humanizeStatus(a.type) },
    {
      key: 'model',
      header: 'Model',
      cell: (a) => [a.manufacturer, a.model].filter(Boolean).join(' ') || '—',
      hideOnMobile: true,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (a) => (
        <StatusBadge tone={statusTone(a.status)}>{humanizeStatus(a.status)}</StatusBadge>
      ),
    },
    {
      key: 'assignedTo',
      header: 'Assigned to',
      cell: (a) => a.assignedTo ?? '—',
      hideOnMobile: true,
    },
  ];

  return (
    <>
      <AddAssetModal open={showAdd} onClose={() => setShowAdd(false)} onSuccess={invalidate} />

      <ListPage
        title="Assets"
        description="The hardware inventory: what exists, what state it is in, and who holds it."
        actions={
          <Button variant="primary" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" strokeWidth={2} />
            Add asset
          </Button>
        }
        search={{
          value: list.search,
          onChange: list.setSearch,
          placeholder: 'Search tag, model or serial…',
        }}
        pageInfo={assets.data?.pageInfo}
        onOffsetChange={list.goToOffset}
        noun="assets"
      >
        <DataTable
          columns={columns}
          rows={assets.data?.data as AssetResponse[] | undefined}
          isLoading={assets.isLoading}
          isError={assets.isError}
          errorMessage="Failed to load assets."
          emptyMessage={list.search ? 'No assets match that search' : 'No assets yet'}
          emptyIcon={Laptop}
          onRowClick={(a) => {
            setSelected(a);
            setPhotoUrl(null);
          }}
          isRowActive={(a) => a.id === selected?.id}
        />
      </ListPage>

      <EntityDetailPanel
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.assetTag ?? 'Asset detail'}
        description={
          selected ? [selected.manufacturer, selected.model].filter(Boolean).join(' ') : undefined
        }
        items={
          selected
            ? [
                {
                  label: 'Tag',
                  value: <span className="font-mono text-xs">{selected.assetTag}</span>,
                },
                { label: 'Type', value: humanizeStatus(selected.type) },
                { label: 'Model', value: selected.model },
                { label: 'Serial', value: selected.serialNumber },
                {
                  label: 'Status',
                  value: (
                    <StatusBadge tone={statusTone(selected.status)}>
                      {humanizeStatus(selected.status)}
                    </StatusBadge>
                  ),
                },
                { label: 'Assigned to', value: selected.assignedTo },
                // Purchase and warranty dates are ON the response and were never shown — the drawer
                // had a `notes` row instead, for a field the response does not carry.
                { label: 'Purchased', value: formatDate(selected.purchaseDate) },
                { label: 'Warranty ends', value: formatDate(selected.warrantyExpiry) },
              ]
            : []
        }
        activity={selected ? { resourceId: selected.id, resourceType: 'asset' } : undefined}
      >
        {selected && (
          <SlideOverSection title="Photo">
            <FileUploadWidget
              mode="image"
              currentUrl={photoUrl}
              presignUrl={`/v1/assets/${selected.id}/photo/presign`}
              confirmUrl={`/v1/assets/${selected.id}/photo/confirm`}
              accept="image/jpeg,image/png,image/webp"
              onSuccess={(url) => {
                setPhotoUrl(url);
                invalidate();
              }}
              label="Asset photo (JPEG, PNG, WebP · max 5 MB)"
            />
          </SlideOverSection>
        )}
      </EntityDetailPanel>
    </>
  );
}
