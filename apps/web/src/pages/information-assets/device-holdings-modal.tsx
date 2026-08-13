import { useState } from 'react';
import { Database, ShieldAlert } from 'lucide-react';
import { assetOptions } from '@/shared/api/picker-sources';
import { Badge, EntityPicker, FormField, Modal, humanizeStatus } from '@/shared/ui';
import { classificationTone } from './asset.types';
import { useDeviceHoldings } from './use-assets';

/**
 * What one device holds — the lost-laptop report.
 *
 * WHY THIS IS ITS OWN SURFACE AND NOT A COLUMN SOMEWHERE. Everything else on this screen reads the
 * asset-to-device link forwards: pick a dataset, see where it lives. This reads it backwards, and it is the
 * direction somebody arrives from in the worst moment — a machine is missing, and the question is whether
 * that is a lost laptop or a reportable breach. The register cannot answer it from the other end: nothing
 * about "customer billing extract" tells you what ELSE was on LT-0042.
 *
 * THE FIRST ROW IS THE ANSWER, and the API sorts worst-classification-first for exactly that reason. This
 * component does not re-rank anything — the ranking lives in `isms.classification_levels`, so a level
 * inserted between two others changes the order with no change here.
 *
 * AN EMPTY LIST IS NOT "THE DEVICE WAS CLEAN". The API deliberately answers an unknown device id with an
 * empty list rather than a 404, so the two cases arrive identically and the copy below has to name the
 * distinction instead of implying the reassuring one.
 */
export function DeviceHoldingsModal({
  deviceAssetId,
  deviceLabel,
  onClose,
}: {
  /** `''` when opened cold from the toolbar, with no device chosen yet. */
  deviceAssetId: string;
  /** The tag of a device chosen elsewhere, so the picker shows a name rather than the raw id. */
  deviceLabel?: string;
  onClose: () => void;
}) {
  const [device, setDevice] = useState({ id: deviceAssetId, label: deviceLabel ?? '' });
  const holdings = useDeviceHoldings(device.id);
  const rows = holdings.data ?? [];

  // From the API's own ordering, not from a rank comparison written here.
  const worst = rows[0];
  const personalData = rows.filter((row) => row.personalData).length;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="What a device holds"
      description="Worst classification first. The question asked the moment a machine is reported lost or stolen."
    >
      <div className="flex flex-col gap-4 p-5">
        <FormField label="Device" htmlFor="holdings-device">
          <EntityPicker
            id="holdings-device"
            queryKey="assets"
            value={device.id}
            selectedLabel={device.label || undefined}
            onChange={(value, option) => setDevice({ id: value, label: option?.label ?? '' })}
            fetchOptions={assetOptions}
            placeholder="Search by asset tag, serial or model…"
          />
        </FormField>

        {!device.id && (
          <p className="text-xs text-fg-subtle">
            Choose a device to see the registered information it is recorded as holding.
          </p>
        )}

        {device.id && (
          <>
            {holdings.isLoading && <p className="text-xs text-fg-subtle">Loading…</p>}
            {holdings.isError && (
              <p className="text-xs text-danger">Failed to load what this device holds.</p>
            )}

            {!holdings.isLoading && !holdings.isError && rows.length === 0 && (
              // Stated as the limit of the register rather than as an all-clear, because the API answers a
              // device it has never heard of with this same empty list.
              <p className="text-xs text-fg-subtle">
                Nothing in the register is recorded on this device. That is not the same as the
                device being empty — only that nothing registered has been linked to it.
              </p>
            )}

            {rows.length > 0 && (
              <>
                {/* The triage line: how much, how bad, and how much of it is personal data — which is
                    what turns a lost device into a breach assessment rather than an inventory update. */}
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-warning" strokeWidth={2} />
                  {rows.length} registered {rows.length === 1 ? 'asset' : 'assets'} · worst
                  <Badge tone={classificationTone(worst.classification)}>
                    {humanizeStatus(worst.classification)}
                  </Badge>
                  {personalData > 0 && <span>· {personalData} hold personal data</span>}
                </p>

                <ul className="flex flex-col gap-2">
                  {rows.map((row) => (
                    <li
                      key={row.informationAssetId}
                      className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5"
                    >
                      <Database
                        className="h-4 w-4 shrink-0 text-fg-subtle"
                        strokeWidth={1.75}
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-fg">{row.name}</p>
                        <p className="truncate font-mono text-xs text-fg-subtle">{row.reference}</p>
                      </div>
                      {row.personalData && <Badge tone="amber">Personal data</Badge>}
                      <Badge tone={classificationTone(row.classification)}>
                        {humanizeStatus(row.classification)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
