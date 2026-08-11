import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Inbox, XCircle } from 'lucide-react';
import { api } from '@/shared/api/client';
import {
  Badge,
  DataTable,
  EntityDetailPanel,
  ListPage,
  SegmentedControl,
  SlideOverSection,
  StatusBadge,
  humanizeStatus,
  statusTone,
  type DataTableColumn,
} from '@/shared/ui';
import { useListState } from '@/shared/hooks/use-list-state';
import { formatDate, formatDateTime } from '@/shared/lib/format';
import { ReviewModal } from './review-modal';
import { isSlaAtRisk, isSlaBreached } from './request-sla';
import type { RequestItemResponse, RequestStatus } from '@/shared/api/types';

/*
 * WHAT THIS SCREEN NO LONGER CARRIES
 *
 * `STATUS_LABEL`, `STATUS_CLASS`, `PRIORITY_CLASS`, `PRIORITY_DOT` and `REQUEST_TYPE_LABEL` — five maps,
 * two of them colours. `PRIORITY_DOT` had a real defect in it: `bg-warning-bg0` and `bg-danger-bg0`,
 * with a trailing zero, so the dot rendered UNSTYLED for exactly the two priorities that matter. A
 * class-name typo cannot be caught by anything; a tone lookup cannot be mistyped without a type error.
 *
 * Also its own `formatDate`, a hand-rolled dialog, six raw header cells, a `dl` grid, a hand-built tab
 * strip, and a query casting the response to `{ data, total }` — `total` at the top level, where the
 * API returns it in `pageInfo`, so the footer read "Showing 12 of undefined requests".
 */

const STATUS_FILTERS: { value: RequestStatus | 'my_queue' | ''; label: string }[] = [
  { value: 'my_queue', label: 'My queue' },
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_review', label: 'In review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

/** Priority → tone. Its own vocabulary: nothing else in the product ranks urgency. */
const PRIORITY_TONE = {
  low: 'neutral',
  normal: 'blue',
  high: 'amber',
  urgent: 'red',
} as const;

function useRequests(filter: RequestStatus | 'my_queue' | '', limit: number, offset: number) {
  return useQuery({
    queryKey: ['requests', 'list', filter, limit, offset],
    queryFn: async () => {
      const { data, error } = await api.GET('/v1/requests', {
        params: {
          query: {
            limit,
            offset,
            // `myQueue` is the parameter the API defines; `status` is the other filter. Exactly one of
            // them applies, which is why this is a branch rather than two optional fields.
            ...(filter === 'my_queue'
              ? { myQueue: true }
              : filter
                ? { status: filter as RequestStatus }
                : {}),
          },
        },
      });
      if (error || !data) throw new Error('Failed to load requests');
      return data;
    },
  });
}

export function RequestsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<RequestStatus | 'my_queue' | ''>('my_queue');
  const [modal, setModal] = useState<{
    req: RequestItemResponse;
    action: 'approve' | 'reject';
  } | null>(null);
  const [selected, setSelected] = useState<RequestItemResponse | null>(null);
  const list = useListState();

  const requests = useRequests(filter, list.limit, list.offset);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['requests'] });

  const columns: DataTableColumn<RequestItemResponse>[] = [
    {
      key: 'request',
      header: 'Request',
      cell: (req) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{humanizeStatus(req.type)}</p>
          <p className="truncate font-mono text-xs text-fg-subtle">{req.id.slice(0, 8)}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (req) => (
        <StatusBadge tone={statusTone(req.status)}>{humanizeStatus(req.status)}</StatusBadge>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      cell: (req) => (
        <Badge tone={PRIORITY_TONE[req.priority as keyof typeof PRIORITY_TONE] ?? 'neutral'}>
          {humanizeStatus(req.priority)}
        </Badge>
      ),
      hideOnMobile: true,
    },
    {
      key: 'submitted',
      header: 'Submitted',
      cell: (req) => <span className="text-xs text-fg-muted">{formatDate(req.submittedAt)}</span>,
      hideOnMobile: true,
    },
    {
      key: 'sla',
      header: 'SLA',
      cell: (req) => {
        if (isSlaBreached(req)) return <StatusBadge tone="red">Breached</StatusBadge>;
        if (isSlaAtRisk(req)) return <StatusBadge tone="amber">At risk</StatusBadge>;
        if (!req.slaDeadline) return <span className="text-xs text-fg-subtle">—</span>;
        return <span className="text-xs text-fg-subtle">Due {formatDate(req.slaDeadline)}</span>;
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      cell: (req) => {
        const actionable = req.status === 'pending' || req.status === 'in_review';
        if (!actionable) return null;
        return (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setModal({ req, action: 'approve' })}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-success transition-colors hover:bg-success-bg"
            >
              <CheckCircle className="h-3.5 w-3.5" strokeWidth={2} />
              Approve
            </button>
            <button
              type="button"
              onClick={() => setModal({ req, action: 'reject' })}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger-bg"
            >
              <XCircle className="h-3.5 w-3.5" strokeWidth={2} />
              Reject
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <>
      {modal && (
        <ReviewModal
          request={modal.req}
          action={modal.action}
          onClose={() => setModal(null)}
          onSuccess={invalidate}
        />
      )}

      <ListPage
        title="Requests Inbox"
        description="Everything awaiting a decision, and everything already decided."
        filters={
          <SegmentedControl
            label="Filter requests"
            options={STATUS_FILTERS}
            value={filter}
            onChange={(value) => {
              setFilter(value);
              list.resetPaging();
            }}
          />
        }
        pageInfo={requests.data?.pageInfo}
        onOffsetChange={list.goToOffset}
        noun="requests"
      >
        <DataTable
          columns={columns}
          rows={requests.data?.data as RequestItemResponse[] | undefined}
          isLoading={requests.isLoading}
          isError={requests.isError}
          errorMessage="Failed to load requests."
          emptyMessage={
            filter === 'my_queue' ? 'Nothing awaiting your decision' : 'No requests found'
          }
          emptyIcon={Inbox}
          onRowClick={setSelected}
          isRowActive={(req) => req.id === selected?.id}
        />
      </ListPage>

      <EntityDetailPanel
        open={!!selected}
        onClose={() => setSelected(null)}
        width="lg"
        title={selected ? humanizeStatus(selected.type) : 'Request'}
        description={
          selected ? `${selected.id.slice(0, 8)} · ${humanizeStatus(selected.status)}` : undefined
        }
        items={
          selected
            ? [
                { label: 'Type', value: humanizeStatus(selected.type) },
                {
                  label: 'Status',
                  value: (
                    <StatusBadge tone={statusTone(selected.status)}>
                      {humanizeStatus(selected.status)}
                    </StatusBadge>
                  ),
                },
                {
                  label: 'Priority',
                  value: (
                    <Badge
                      tone={
                        PRIORITY_TONE[selected.priority as keyof typeof PRIORITY_TONE] ?? 'neutral'
                      }
                    >
                      {humanizeStatus(selected.priority)}
                    </Badge>
                  ),
                },
                { label: 'Submitted', value: formatDateTime(selected.submittedAt) },
                {
                  label: 'Requester',
                  value: <span className="font-mono text-xs">{selected.requesterId}</span>,
                },
                {
                  label: 'Assignee',
                  value: selected.assigneeId ? (
                    <span className="font-mono text-xs">{selected.assigneeId}</span>
                  ) : null,
                },
                { label: 'SLA deadline', value: formatDateTime(selected.slaDeadline) },
                {
                  label: 'Steps',
                  value:
                    selected.totalSteps > 1
                      ? `Step ${selected.currentStep} of ${selected.totalSteps}`
                      : null,
                },
                { label: 'Resolution note', value: selected.resolutionNote, wide: true },
              ]
            : []
        }
        activity={selected ? { resourceId: selected.id, resourceType: 'request' } : undefined}
      >
        {selected && (selected.approvals?.length ?? 0) > 0 && (
          <SlideOverSection title="Approval history">
            <ol className="flex flex-col gap-2">
              {selected.approvals!.map((a) => (
                <li key={a.id} className="flex items-start gap-3">
                  <StatusBadge tone={statusTone(a.decision)}>
                    Step {a.step} — {humanizeStatus(a.decision)}
                  </StatusBadge>
                  <div className="min-w-0 flex-1 text-xs text-fg-muted">
                    <p className="font-mono">{a.approverId}</p>
                    {a.note && <p className="mt-0.5">{a.note}</p>}
                    <p className="mt-0.5 text-fg-subtle">{formatDateTime(a.decidedAt)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </SlideOverSection>
        )}
      </EntityDetailPanel>
    </>
  );
}
