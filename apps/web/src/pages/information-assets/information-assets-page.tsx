import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Database, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EntityDetailPanel,
  ListPage,
  PanelAction,
  RowAction,
  RowActions,
  SegmentedControl,
  SlideOverSection,
  StatCard,
  StatGrid,
  humanizeStatus,
  type DataTableColumn,
} from '@/shared/ui';
import { useListState } from '@/shared/hooks/use-list-state';
import { usePermissions } from '@/shared/hooks/use-permissions';
import { formatDate, orDash } from '@/shared/lib/format';
import { RegisterAssetModal, ReclassifyAssetModal } from './asset-modals';
import { AssetDevicesPanel, ClassificationHistoryPanel } from './asset-panels';
import { CLASSIFICATION_FILTERS, classificationTone } from './asset.types';
import {
  useClassificationLevels,
  useClassificationSummary,
  useInformationAssets,
} from './use-assets';
import type { InformationAsset } from './asset.types';

/**
 * The information-asset register: what data exists, how sensitive it is, who owns it, and where it lives.
 *
 * CLASSIFICATION IS A DECISION WITH A HISTORY, not a field. Every change carries a reason and appends a
 * row, so the register answers "when did this become restricted and who said so" — and LOWERING a
 * classification is a different permission (`information_asset.declassify`) because it takes protection
 * away. The screen routes to the endpoint that matches the direction rather than asking the user which.
 *
 * THE THREE CIA RATINGS STAY SEPARATE. A public dataset can still be availability-critical; a single
 * combined score would throw that away, and the API keeps them apart for the same reason.
 *
 * THE DEVICE COUNT IS ON THE ROW because "how sensitive" and "where is it" are only useful together — a
 * restricted dataset on three laptops is the finding, and it is invisible from either register alone.
 */
export function InformationAssetsPage() {
  const qc = useQueryClient();
  const list = useListState();
  const { can } = usePermissions();
  const canManage = can('information_asset.manage');
  const canDeclassify = can('information_asset.declassify');

  const [classification, setClassification] = useState('');
  const [personalDataOnly, setPersonalDataOnly] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [reclassifying, setReclassifying] = useState<InformationAsset | null>(null);
  const [reviewing, setReviewing] = useState<InformationAsset | null>(null);
  const [selected, setSelected] = useState<InformationAsset | null>(null);

  const assets = useInformationAssets({
    classification,
    type: '',
    personalDataOnly,
    search: list.search,
    limit: list.limit,
    offset: list.offset,
  });
  const summary = useClassificationSummary();
  const levels = useClassificationLevels();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['information-assets'] });

  const levelFor = (code: string) => levels.data?.find((level) => level.code === code);

  async function markReviewed() {
    if (!reviewing) return;
    const { error } = await api.POST('/v1/information-assets/{id}/reviewed', {
      params: { path: { id: reviewing.id } },
      // No next date: the API keeps the asset's existing schedule rather than having this button
      // silently rewrite it.
      body: {},
    });
    setReviewing(null);
    if (error) {
      toast.error(apiErrorMessage(error, 'Failed to record the review.'));
      return;
    }
    toast.success('Review recorded');
    invalidate();
  }

  function applyFilter(apply: () => void) {
    apply();
    list.resetPaging();
  }

  const columns: DataTableColumn<InformationAsset>[] = [
    {
      key: 'reference',
      header: 'Reference',
      cell: (asset) => (
        <span className="font-mono text-xs font-medium text-fg">{asset.reference}</span>
      ),
    },
    {
      key: 'name',
      header: 'Asset',
      cell: (asset) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg">{asset.name}</p>
          <p className="truncate text-xs text-fg-subtle">{humanizeStatus(asset.type)}</p>
        </div>
      ),
    },
    {
      key: 'classification',
      header: 'Classification',
      cell: (asset) => (
        <div className="flex items-center gap-1.5">
          <Badge tone={classificationTone(asset.classification)}>
            {humanizeStatus(asset.classification)}
          </Badge>
          {/* From the level, not from the asset: encryption is a property of the classification. */}
          {asset.encryptionRequired && <span className="text-xs text-warning">encrypted</span>}
        </div>
      ),
    },
    {
      key: 'cia',
      header: 'C·I·A',
      align: 'right',
      cell: (asset) => (
        <span className="tabular-nums text-xs text-fg-muted">
          {asset.confidentiality}·{asset.integrity}·{asset.availability}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: 'personalData',
      header: 'Personal data',
      cell: (asset) =>
        asset.personalData ? (
          <Badge tone="amber">Yes</Badge>
        ) : (
          <span className="text-xs text-fg-subtle">No</span>
        ),
    },
    {
      key: 'devices',
      header: 'Devices',
      align: 'right',
      // Zero is meaningful — nothing registered holds it — so it is a number, not a dash.
      cell: (asset) => <span className="tabular-nums">{asset.deviceCount}</span>,
      hideOnMobile: true,
    },
    {
      key: 'review',
      header: 'Review due',
      cell: (asset) => formatDate(asset.reviewDueOn),
      hideOnMobile: true,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (asset) => (
        <RowActions>
          {(canManage || canDeclassify) && (
            <RowAction tone="accent" onClick={() => setReclassifying(asset)}>
              Reclassify
            </RowAction>
          )}
          {canManage && (
            <RowAction tone="success" onClick={() => setReviewing(asset)}>
              Reviewed
            </RowAction>
          )}
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <RegisterAssetModal
        open={registering}
        onClose={() => setRegistering(false)}
        onSuccess={invalidate}
      />
      {reclassifying && (
        <ReclassifyAssetModal
          asset={reclassifying}
          onClose={() => setReclassifying(null)}
          onSuccess={invalidate}
        />
      )}

      <ConfirmDialog
        open={!!reviewing}
        onCancel={() => setReviewing(null)}
        onConfirm={markReviewed}
        title="Record a review of this asset?"
        description="Stamps today as the last review. The next due date stays as it is — changing the schedule is an edit, not a review."
        confirmLabel="Record review"
      />

      <ListPage
        title="Information assets"
        description="What data the organisation holds, how sensitive it is, who owns it, and which devices hold it."
        actions={
          canManage ? (
            <Button variant="primary" onClick={() => setRegistering(true)}>
              <Plus className="h-4 w-4" strokeWidth={2} />
              Register an asset
            </Button>
          ) : undefined
        }
        search={{
          value: list.search,
          onChange: list.setSearch,
          placeholder: 'Search assets…',
        }}
        filters={
          <>
            <SegmentedControl
              label="Filter by classification"
              options={CLASSIFICATION_FILTERS.map((option) => ({ ...option }))}
              value={classification}
              onChange={(value) => applyFilter(() => setClassification(value))}
            />
            <Button
              variant={personalDataOnly ? 'primary' : 'outline'}
              size="sm"
              aria-pressed={personalDataOnly}
              onClick={() => applyFilter(() => setPersonalDataOnly(!personalDataOnly))}
            >
              Personal data only
            </Button>
          </>
        }
        pageInfo={assets.data?.pageInfo}
        onOffsetChange={list.goToOffset}
        noun="asset"
      >
        {/* The register's shape at a glance, and it is the report an audit opens with: how much sits at
            each level, and how much of THAT is personal data or on a device. */}
        <StatGrid>
          {(summary.data ?? [])
            .slice()
            .sort((a, b) => b.rank - a.rank)
            .map((row) => (
              <StatCard
                key={row.classification}
                label={humanizeStatus(row.classification)}
                value={row.assets}
                hint={`${row.personalDataAssets} personal data · ${row.onDevices} on devices`}
                tone={classificationTone(row.classification)}
                loading={summary.isLoading}
              />
            ))}
        </StatGrid>

        <div className="mt-4">
          <DataTable
            columns={columns}
            rows={assets.data?.data}
            isLoading={assets.isLoading}
            isError={assets.isError}
            errorMessage="Failed to load the information-asset register."
            emptyMessage="No assets match these filters"
            emptyIcon={Database}
            onRowClick={setSelected}
            isRowActive={(asset) => asset.id === selected?.id}
          />
        </div>
      </ListPage>

      <EntityDetailPanel
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name ?? 'Information asset'}
        description={selected?.reference}
        headerActions={
          selected && (canManage || canDeclassify) ? (
            <PanelAction tone="accent" onClick={() => setReclassifying(selected)}>
              Reclassify
            </PanelAction>
          ) : undefined
        }
        items={
          selected
            ? [
                {
                  label: 'Classification',
                  value: (
                    <Badge tone={classificationTone(selected.classification)}>
                      {humanizeStatus(selected.classification)}
                    </Badge>
                  ),
                },
                {
                  label: 'Handling',
                  wide: true,
                  // The policy's own words, from the reference table.
                  value: orDash(levelFor(selected.classification)?.handlingRules),
                },
                { label: 'Type', value: humanizeStatus(selected.type) },
                {
                  label: 'Owner',
                  value: <span className="font-mono text-xs">{selected.ownerId}</span>,
                },
                {
                  label: 'Custodian',
                  value: selected.custodianId ? (
                    <span className="font-mono text-xs">{selected.custodianId}</span>
                  ) : (
                    'Same as owner'
                  ),
                },
                {
                  label: 'C·I·A',
                  value: `${selected.confidentiality} · ${selected.integrity} · ${selected.availability}`,
                },
                { label: 'Personal data', value: selected.personalData ? 'Yes' : 'No' },
                { label: 'Location', value: orDash(selected.location) },
                {
                  label: 'Retention',
                  value: selected.retentionMonths
                    ? `${selected.retentionMonths} months`
                    : 'Not recorded',
                },
                { label: 'Last reviewed', value: formatDate(selected.lastReviewedAt) },
                { label: 'Review due', value: formatDate(selected.reviewDueOn) },
                ...(selected.description
                  ? [{ label: 'Description', wide: true, value: selected.description }]
                  : []),
              ]
            : []
        }
        activity={
          selected ? { resourceId: selected.id, resourceType: 'information_asset' } : undefined
        }
      >
        {selected && (
          <>
            <SlideOverSection title="Classification history">
              <ClassificationHistoryPanel assetId={selected.id} />
            </SlideOverSection>
            <SlideOverSection title={`Devices (${selected.deviceCount})`}>
              <AssetDevicesPanel
                assetId={selected.id}
                encryptionRequired={selected.encryptionRequired}
              />
            </SlideOverSection>
          </>
        )}
      </EntityDetailPanel>
    </>
  );
}
