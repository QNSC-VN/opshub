import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, PenLine, ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/shared/api/client';
import { apiErrorMessage } from '@/shared/api/errors';
import {
  Badge,
  DataTable,
  RowAction,
  RowActions,
  StatCard,
  StatGrid,
  StatusBadge,
  humanizeStatus,
  statusTone,
  type DataTableColumn,
} from '@/shared/ui';
import { formatDate } from '@/shared/lib/format';
import { RateReviewModal, SelfAssessmentModal } from './rating-modals';
import { useCycleLabels, useMyReviews, useReviewsToWrite } from './use-performance';
import type { Review } from './performance.types';

/**
 * The caller's own two queues: reviews ABOUT them, and reviews they OWE.
 *
 * BOTH ENDPOINTS ARE SELF-SCOPED — `/me` and `/me/to-review` are keyed on the caller's own id by the
 * API, which is what lets an employee holding no permission codes see their own review, and a manager
 * write the reviews they were given without `performance.manage`. No UI check here would add anything.
 *
 * TWO TABLES, NOT ONE FILTERED LIST. "What do I have to say about myself" and "whose review am I
 * writing" are different jobs with different actions, and a single table would need a column explaining
 * which side of it each row is on.
 */
export function MyReviewsTab() {
  const qc = useQueryClient();
  const mine = useMyReviews();
  const toWrite = useReviewsToWrite();
  const [selfAssessing, setSelfAssessing] = useState<Review | null>(null);
  const [rating, setRating] = useState<Review | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['performance'] });

  const myRows = mine.data?.data ?? [];
  const owedRows = toWrite.data?.data ?? [];
  // Both tables at once: the cycles named by either list, fetched by id rather than taken from a
  // truncated page — see `useCycleLabels`.
  const cycleNames = useCycleLabels([...myRows, ...owedRows].map((review) => review.cycleId));
  const cycleLabel = (id: string) => cycleNames.get(id)?.reference ?? id;
  const cycleDue = (id: string) => cycleNames.get(id)?.reviewDue;
  const awaitingMe = myRows.filter(
    (review) => review.status === 'self_assessment' || review.status === 'shared',
  ).length;
  const owedByMe = owedRows.filter((review) => review.status === 'manager_review').length;

  async function acknowledge(review: Review) {
    const { error } = await api.POST('/v1/performance/reviews/{id}/acknowledge', {
      params: { path: { id: review.id } },
    });
    if (error) {
      toast.error(apiErrorMessage(error, 'Failed to acknowledge the review.'));
      return;
    }
    toast.success('Review acknowledged');
    invalidate();
  }

  const myColumns: DataTableColumn<Review>[] = [
    {
      key: 'cycle',
      header: 'Cycle',
      cell: (review) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-xs font-medium text-fg">
            {cycleLabel(review.cycleId)}
          </p>
          <p className="truncate text-xs text-fg-subtle">
            Due {formatDate(cycleDue(review.cycleId))}
          </p>
        </div>
      ),
    },
    {
      key: 'rating',
      header: 'Rating',
      // A rating is only visible once the review is SHARED; before that it exists and is not yours to
      // see, which is why this says "Not shared yet" rather than showing a blank.
      cell: (review) =>
        review.overallRating ? (
          <Badge>{humanizeStatus(review.overallRating)}</Badge>
        ) : (
          <span className="text-xs text-fg-subtle">Not shared yet</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (review) => (
        <StatusBadge tone={statusTone(review.status)}>{humanizeStatus(review.status)}</StatusBadge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (review) => (
        <RowActions>
          {review.status === 'self_assessment' && (
            <RowAction tone="accent" onClick={() => setSelfAssessing(review)}>
              {review.selfAssessment ? 'Edit self-assessment' : 'Self-assess'}
            </RowAction>
          )}
          {review.status === 'shared' && (
            <RowAction tone="success" onClick={() => void acknowledge(review)}>
              Acknowledge
            </RowAction>
          )}
        </RowActions>
      ),
    },
  ];

  const owedColumns: DataTableColumn<Review>[] = [
    {
      key: 'cycle',
      header: 'Cycle',
      cell: (review) => (
        <span className="font-mono text-xs font-medium text-fg">{cycleLabel(review.cycleId)}</span>
      ),
    },
    {
      key: 'employee',
      header: 'Employee',
      cell: (review) => (
        <span className="font-mono text-xs text-fg-muted">{review.employeeId}</span>
      ),
    },
    {
      key: 'selfAssessment',
      header: 'Self-assessment',
      // Whether the employee has had their say is the first thing a reviewer needs to know.
      cell: (review) =>
        review.selfAssessmentSubmittedAt ? (
          <Badge tone="green">Submitted</Badge>
        ) : (
          <span className="text-xs text-fg-subtle">Not yet</span>
        ),
      hideOnMobile: true,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (review) => (
        <StatusBadge tone={statusTone(review.status)}>{humanizeStatus(review.status)}</StatusBadge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (review) => (
        <RowActions>
          {review.status === 'manager_review' && (
            <RowAction tone="accent" onClick={() => setRating(review)}>
              {review.overallRating ? 'Edit rating' : 'Rate'}
            </RowAction>
          )}
        </RowActions>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      {selfAssessing && (
        <SelfAssessmentModal
          review={selfAssessing}
          onClose={() => setSelfAssessing(null)}
          onSuccess={invalidate}
        />
      )}
      {rating && (
        <RateReviewModal review={rating} onClose={() => setRating(null)} onSuccess={invalidate} />
      )}

      <StatGrid>
        <StatCard
          label="Waiting on me"
          value={awaitingMe}
          icon={PenLine}
          tone="amber"
          alert
          loading={mine.isLoading}
        />
        <StatCard
          label="Reviews I owe"
          value={owedByMe}
          icon={ClipboardCheck}
          tone="amber"
          alert
          loading={toWrite.isLoading}
        />
        <StatCard
          label="Acknowledged"
          value={myRows.filter((review) => review.status === 'acknowledged').length}
          icon={ThumbsUp}
          tone="green"
          loading={mine.isLoading}
        />
      </StatGrid>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">My reviews</h2>
        <DataTable
          columns={myColumns}
          rows={myRows}
          isLoading={mine.isLoading}
          isError={mine.isError}
          errorMessage="Failed to load your reviews."
          emptyMessage="No reviews about you yet"
          emptyIcon={ClipboardCheck}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          Reviews assigned to me
        </h2>
        <DataTable
          columns={owedColumns}
          rows={owedRows}
          isLoading={toWrite.isLoading}
          isError={toWrite.isError}
          errorMessage="Failed to load the reviews assigned to you."
          emptyMessage="Nobody's review is waiting on you"
          emptyIcon={PenLine}
        />
      </section>
    </div>
  );
}
