import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RadioTower, ScanSearch } from 'lucide-react';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import { formatDateTime } from '@/shared/lib/format';
import { usePermissions } from '@/shared/hooks/use-permissions';
import {
  Badge,
  Button,
  DataTable,
  StatusBadge,
  TabToolbar,
  humanizeStatus,
  statusTone,
  type DataTableColumn,
} from '@/shared/ui';
import type { components } from '@/shared/api/generated/api';

type Finding = components['schemas']['FindingResponseDto'];

/**
 * Software found on managed devices that the catalogue does not whitelist.
 *
 * WHY THIS TAB WAS EMPTY UNTIL NOW, and what actually had to change. The screen showed an upgrade gate
 * unconditionally, so even a tenant WITH Intune configured could not see a single detection — and the two
 * endpoints behind it returned untyped object literals, so the generated client typed them as `unknown` and
 * nothing could consume them. Both routes now carry response DTOs, and this renders the findings when the
 * integration is configured.
 *
 * A SCAN IS NOT A REFRESH. `POST /shadow-it/scan` walks the Intune device inventory, which costs Graph calls
 * and takes real time, so it is an explicit action gated on `compliance.manage` — and it reports what it
 * examined and what it CREATED, because "scanned 400 devices, 0 new findings" is a good outcome that a silent
 * refresh would make look like a failure.
 */
export function ShadowItPanel() {
  const { can } = usePermissions();
  const canScan = can('compliance.manage');
  const queryClient = useQueryClient();

  const findings = useQuery({
    queryKey: ['compliance', 'shadow-it'],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/compliance/shadow-it');
      if (error || !data) throw new Error('Failed to load the Shadow IT findings');
      return data;
    },
  });

  const scan = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST('/v1/compliance/shadow-it/scan');
      if (error || !data) throw new Error(apiErrorMessage(error, 'Failed to run the scan.'));
      return data;
    },
    onSuccess: (result) => {
      // Both numbers, always. `scanned: 0` means the integration is not configured rather than that
      // everything is clean, and those need different responses from whoever clicked.
      toast.success(
        result.scanned === 0
          ? 'Nothing was scanned — the Intune integration is not configured'
          : `Scanned ${result.scanned} device(s), ${result.newFindings} new finding(s)`,
      );
      void queryClient.invalidateQueries({ queryKey: ['compliance'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = findings.data?.findings ?? [];

  const columns: DataTableColumn<Finding>[] = [
    {
      key: 'software',
      header: 'Software',
      cell: (f) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg">{f.softwareName}</p>
          {f.softwareVersion && (
            <p className="truncate text-xs text-fg-subtle">version {f.softwareVersion}</p>
          )}
        </div>
      ),
    },
    {
      key: 'severity',
      header: 'Severity',
      cell: (f) => <Badge tone={statusTone(f.severity)}>{humanizeStatus(f.severity)}</Badge>,
    },
    {
      key: 'where',
      header: 'Found on',
      // The device and the person are what make a detection actionable: the same app is a different
      // problem on a developer's laptop and on a shared kiosk.
      cell: (f) => (
        <span className="font-mono text-xs text-fg-muted">{f.assetId ?? f.employeeId ?? '—'}</span>
      ),
      hideOnMobile: true,
    },
    {
      key: 'detected',
      header: 'Detected',
      cell: (f) => <span className="text-xs text-fg-muted">{formatDateTime(f.detectedAt)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (f) => (
        <StatusBadge tone={statusTone(f.status)}>{humanizeStatus(f.status)}</StatusBadge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <TabToolbar
        filter={
          <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
            <RadioTower className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            Software on managed devices that the catalogue does not whitelist. Resolve one by
            whitelisting it, or by removing it from the device.
          </p>
        }
        action={
          canScan ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => scan.mutate()}
              disabled={scan.isPending}
            >
              <ScanSearch className="h-4 w-4" strokeWidth={2} />
              {scan.isPending ? 'Scanning…' : 'Run a scan'}
            </Button>
          ) : undefined
        }
      />

      {/* The cap is the API's — a hundred rows — and saying so beats a page that silently ends. */}
      {rows.length > 0 && (
        <p className="text-xs text-fg-subtle">
          Showing {rows.length} detection(s), most recent first.
        </p>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        isLoading={findings.isLoading}
        isError={findings.isError}
        errorMessage="Failed to load the Shadow IT findings."
        emptyMessage="No unapproved software detected"
        emptyIcon={RadioTower}
      />
    </div>
  );
}
