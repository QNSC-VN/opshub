import { ArrowRight, Laptop, ShieldAlert } from 'lucide-react';
import { Badge, humanizeStatus } from '@/shared/ui';
import { formatDateTime, orDash } from '@/shared/lib/format';
import { classificationTone } from './asset.types';
import { useAssetDevices, useClassificationHistory } from './use-assets';

/**
 * The two things a drawer has to answer about an information asset: how its classification got here, and
 * where the data physically is.
 */

/**
 * Every classification change, oldest first.
 *
 * The audit question is not "what is this classified as" — the row says that — but "when did it become
 * that, and who said so". `fromLevel: null` is the REGISTRATION, which is why it reads as "registered as"
 * rather than showing a dash and leaving somebody to infer it.
 */
export function ClassificationHistoryPanel({ assetId }: { assetId: string }) {
  const history = useClassificationHistory(assetId);
  const rows = history.data ?? [];

  return (
    <div className="flex flex-col gap-2">
      {history.isLoading && <p className="text-xs text-fg-subtle">Loading…</p>}
      {history.isError && <p className="text-xs text-danger">Failed to load the history.</p>}
      {!history.isLoading && !history.isError && rows.length === 0 && (
        <p className="text-xs text-fg-subtle">No changes recorded</p>
      )}

      {rows.map((change) => (
        <div
          key={change.id}
          className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs"
        >
          <div className="flex items-center gap-1.5">
            {change.fromLevel ? (
              <>
                <Badge tone={classificationTone(change.fromLevel)}>
                  {humanizeStatus(change.fromLevel)}
                </Badge>
                <ArrowRight className="h-3 w-3 text-fg-subtle" aria-hidden="true" />
              </>
            ) : (
              <span className="text-fg-subtle">registered as</span>
            )}
            <Badge tone={classificationTone(change.toLevel)}>
              {humanizeStatus(change.toLevel)}
            </Badge>
            <span className="text-fg-subtle">{formatDateTime(change.changedAt)}</span>
          </div>
          <p className="mt-0.5 whitespace-pre-wrap text-fg-muted">{change.reason}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * The devices this asset is held on.
 *
 * WHY THIS PANEL EXISTS. Classifying data answers "how sensitive is it"; this answers "where is it" — and
 * the finding lives in the pair. A restricted dataset on a laptop is not visible from either register
 * alone, which is why the link exists at all and why the count is on the list row too.
 */
export function AssetDevicesPanel({
  assetId,
  encryptionRequired,
}: {
  assetId: string;
  /** From the classification level, so the warning below states policy rather than opinion. */
  encryptionRequired: boolean;
}) {
  const devices = useAssetDevices(assetId);
  const rows = devices.data ?? [];

  return (
    <div className="flex flex-col gap-2">
      {devices.isLoading && <p className="text-xs text-fg-subtle">Loading…</p>}
      {devices.isError && <p className="text-xs text-danger">Failed to load the devices.</p>}
      {!devices.isLoading && !devices.isError && rows.length === 0 && (
        <p className="text-xs text-fg-subtle">Not held on any registered device</p>
      )}

      {/* Stated once, above the list, when the level demands encryption: every device below is then a
          place that claim has to be true. */}
      {rows.length > 0 && encryptionRequired && (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          This classification requires encryption, so each device below has to be encrypted at rest.
        </p>
      )}

      {rows.map((device) => (
        <div
          key={device.deviceAssetId}
          className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5"
        >
          <Laptop className="h-4 w-4 shrink-0 text-fg-subtle" strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-xs font-medium text-fg">{device.assetTag}</p>
            <p className="truncate text-xs text-fg-subtle">
              {humanizeStatus(device.type)} · {humanizeStatus(device.status)}
            </p>
          </div>
          {/* An unassigned device holding classified data is its own question, so the absence is named. */}
          <span className="shrink-0 text-xs text-fg-subtle">
            {device.assignedTo ? orDash(device.assignedTo) : 'Unassigned'}
          </span>
        </div>
      ))}
    </div>
  );
}
