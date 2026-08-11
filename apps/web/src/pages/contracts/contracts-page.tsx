import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, FileText, Plus } from 'lucide-react';
import { api } from '@/shared/api/client';
import {
  Badge,
  Button,
  DataTable,
  EntityDetailPanel,
  ListPage,
  SegmentedControl,
  StatusBadge,
  humanizeStatus,
  statusTone,
  type DataTableColumn,
} from '@/shared/ui';
import { useListState } from '@/shared/hooks/use-list-state';
import { formatDate, isoDaysFromNow } from '@/shared/lib/format';
import {
  ActivateContractModal,
  DraftContractModal,
  TerminateContractModal,
} from './contract-modals';
import { COMPENSATION_HIDDEN, type Contract } from './contract.types';

/**
 * Employment contracts — the second module whose API had no screen.
 *
 * THE PAY COLUMN IS DELIBERATELY UNINFORMATIVE WHEN HIDDEN. `compensation` comes back null both when no
 * figures are recorded AND when the caller lacks `contract.compensation.read`; the API returns the same
 * shape for both so that the absence of a figure cannot be read as evidence that one exists. The UI
 * keeps that property: it says "Not shown" and does not guess which case it is in. Writing
 * "No pay recorded" would leak exactly what the permission protects.
 *
 * THE RENEWAL QUEUE is `endingOnOrBefore`, an API filter that narrows to ACTIVE contracts ending by a
 * date. Computing it here from the row list would only ever see the current page.
 */

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'expiring_soon', label: 'Expiring' },
  { value: 'terminated', label: 'Terminated' },
];

/** 90 days out: the window HR needs to act on a renewal, and the one the API report uses. */
const RENEWAL_HORIZON_DAYS = 90;

function useContracts(status: string, renewalsOnly: boolean, limit: number, offset: number) {
  return useQuery({
    queryKey: ['contracts', 'list', status, renewalsOnly, limit, offset],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/contracts', {
        params: {
          query: {
            status: (status || undefined) as never,
            endingOnOrBefore: renewalsOnly ? isoDaysFromNow(RENEWAL_HORIZON_DAYS) : undefined,
            limit,
            offset,
          },
        },
      });
      if (error || !data) throw new Error('Failed to load contracts');
      return data;
    },
  });
}

export function ContractsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('active');
  const [renewalsOnly, setRenewalsOnly] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [terminating, setTerminating] = useState<Contract | null>(null);
  const [activating, setActivating] = useState<Contract | null>(null);
  const [selected, setSelected] = useState<Contract | null>(null);
  const list = useListState();

  const contracts = useContracts(statusFilter, renewalsOnly, list.limit, list.offset);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['contracts'] });

  const columns: DataTableColumn<Contract>[] = [
    {
      key: 'reference',
      header: 'Reference',
      cell: (c) => <span className="font-mono text-xs font-medium text-fg">{c.reference}</span>,
    },
    {
      key: 'employee',
      header: 'Employee',
      cell: (c) => <span className="font-mono text-xs text-fg-muted">{c.employeeId}</span>,
    },
    {
      key: 'type',
      header: 'Type',
      cell: (c) => <Badge>{humanizeStatus(c.contractType)}</Badge>,
      hideOnMobile: true,
    },
    { key: 'start', header: 'Start', cell: (c) => formatDate(c.startDate) },
    {
      key: 'end',
      header: 'End',
      // An open-ended contract has no end, which is a fact rather than a gap — hence the em dash and
      // not "ongoing", which would read as a status.
      cell: (c) => formatDate(c.endDate),
      hideOnMobile: true,
    },
    {
      key: 'pay',
      header: 'Pay',
      align: 'right',
      cell: (c) =>
        c.compensation ? (
          <span className="tabular-nums">
            {c.compensation.baseSalary} {c.compensation.salaryCurrency}
            <span className="ml-1 text-xs text-fg-subtle">
              /{humanizeStatus(c.compensation.salaryPeriod).toLowerCase()}
            </span>
          </span>
        ) : (
          <span className="text-xs text-fg-subtle">{COMPENSATION_HIDDEN}</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (c) => (
        <StatusBadge tone={statusTone(c.status)}>{humanizeStatus(c.status)}</StatusBadge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (c) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {c.status === 'draft' && (
            <Button variant="outline" size="sm" onClick={() => setActivating(c)}>
              Activate
            </Button>
          )}
          {(c.status === 'active' || c.status === 'expiring_soon') && (
            <Button variant="outline" size="sm" onClick={() => setTerminating(c)}>
              Terminate
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <DraftContractModal
        open={drafting}
        onClose={() => setDrafting(false)}
        onSuccess={invalidate}
      />
      {activating && (
        <ActivateContractModal
          contract={activating}
          onClose={() => setActivating(null)}
          onSuccess={invalidate}
        />
      )}
      {terminating && (
        <TerminateContractModal
          contract={terminating}
          onClose={() => setTerminating(null)}
          onSuccess={invalidate}
        />
      )}

      <ListPage
        title="Contracts"
        description="Employment terms, their lifecycle, and what renews soon."
        actions={
          <Button variant="primary" onClick={() => setDrafting(true)}>
            <Plus className="h-4 w-4" strokeWidth={2} />
            Draft contract
          </Button>
        }
        filters={
          <>
            <SegmentedControl
              label="Filter by status"
              options={STATUS_FILTERS}
              value={statusFilter}
              onChange={(value) => {
                setStatusFilter(value);
                setRenewalsOnly(false);
                list.resetPaging();
              }}
            />
            <Button
              variant={renewalsOnly ? 'primary' : 'outline'}
              size="sm"
              aria-pressed={renewalsOnly}
              onClick={() => {
                // A toggle rather than another segment: it NARROWS whatever status is selected, so it
                // is a second axis and not a fifth alternative.
                setRenewalsOnly((v) => !v);
                list.resetPaging();
              }}
            >
              <CalendarClock className="h-3.5 w-3.5" />
              Renewing in {RENEWAL_HORIZON_DAYS} days
            </Button>
          </>
        }
        pageInfo={contracts.data?.pageInfo}
        onOffsetChange={list.goToOffset}
        noun="contracts"
      >
        <DataTable
          columns={columns}
          rows={contracts.data?.data as Contract[] | undefined}
          isLoading={contracts.isLoading}
          isError={contracts.isError}
          errorMessage="Failed to load contracts."
          emptyMessage={
            renewalsOnly ? 'Nothing renewing in that window' : 'No contracts match this filter'
          }
          emptyIcon={FileText}
          onRowClick={setSelected}
          isRowActive={(c) => c.id === selected?.id}
        />
      </ListPage>

      <EntityDetailPanel
        open={!!selected}
        onClose={() => setSelected(null)}
        width="lg"
        title={selected?.reference ?? 'Contract'}
        description={selected ? humanizeStatus(selected.contractType) : undefined}
        items={
          selected
            ? [
                {
                  label: 'Reference',
                  value: <span className="font-mono text-xs">{selected.reference}</span>,
                },
                {
                  label: 'Status',
                  value: (
                    <StatusBadge tone={statusTone(selected.status)}>
                      {humanizeStatus(selected.status)}
                    </StatusBadge>
                  ),
                },
                {
                  label: 'Employee',
                  value: <span className="font-mono text-xs">{selected.employeeId}</span>,
                },
                {
                  label: 'Position',
                  value: selected.positionId ? (
                    <span className="font-mono text-xs">{selected.positionId}</span>
                  ) : null,
                },
                { label: 'Start', value: formatDate(selected.startDate) },
                { label: 'End', value: formatDate(selected.endDate) },
                { label: 'Probation ends', value: formatDate(selected.probationEndDate) },
                { label: 'Notice period', value: `${selected.noticePeriodDays} days` },
                { label: 'Signed', value: formatDate(selected.signedAt) },
                {
                  label: 'Pay',
                  value: selected.compensation
                    ? `${selected.compensation.baseSalary} ${selected.compensation.salaryCurrency} / ${humanizeStatus(selected.compensation.salaryPeriod).toLowerCase()}`
                    : COMPENSATION_HIDDEN,
                },
                { label: 'Terminated on', value: formatDate(selected.terminatedOn) },
                { label: 'Termination reason', value: selected.terminationReason, wide: true },
                { label: 'Notes', value: selected.notes, wide: true },
              ]
            : []
        }
        activity={
          selected ? { resourceId: selected.id, resourceType: 'employment-contract' } : undefined
        }
      />
    </>
  );
}
