import { AlertTriangle, GraduationCap, ShieldCheck } from 'lucide-react';
import {
  Badge,
  DataTable,
  StatCard,
  StatGrid,
  StatusBadge,
  humanizeStatus,
  statusTone,
  type DataTableColumn,
} from '@/shared/ui';
import { formatDate, orDash } from '@/shared/lib/format';
import { useCourseLookup, useMyGaps, useMyTraining } from './use-training';
import type { CompetencyGap, TrainingRecord } from './training.types';

/**
 * The caller's own training — the only tab an employee can use.
 *
 * SELF-SCOPED, so it holds no permission check. `GET /v1/training/me` is keyed on the caller's own id by
 * the API, which is what lets an employee — who holds NO permission codes at all in this product's model
 * — see their own record without being able to see anybody else's. A UI check here would be decoration
 * on top of the real rule.
 *
 * GAPS COME FIRST because they are the only part that asks the reader to do something. The history below
 * is reference; the two tiles at the top are the answer to "am I up to date".
 */
export function MyTrainingTab() {
  const records = useMyTraining();
  const gaps = useMyGaps();
  const courses = useCourseLookup();

  const courseTitle = (id: string) => courses.data?.get(id)?.title ?? id;
  const courseCode = (id: string) => courses.data?.get(id)?.code ?? '';

  const mine = records.data ?? [];
  const myGaps = gaps.data ?? [];
  const mandatoryGaps = myGaps.filter((gap) => gap.kind === 'mandatory').length;
  const valid = mine.filter((record) => record.status === 'valid').length;

  const gapColumns: DataTableColumn<CompetencyGap>[] = [
    {
      key: 'course',
      header: 'Course',
      cell: (gap) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg">{gap.courseTitle}</p>
          <p className="truncate font-mono text-xs text-fg-subtle">{gap.courseCode}</p>
        </div>
      ),
    },
    {
      key: 'kind',
      header: 'Kind',
      cell: (gap) => (
        <Badge tone={gap.kind === 'mandatory' ? 'red' : 'blue'}>{humanizeStatus(gap.kind)}</Badge>
      ),
    },
    {
      key: 'reason',
      header: 'Why',
      cell: (gap) => <StatusBadge tone="amber">{humanizeStatus(gap.reason)}</StatusBadge>,
    },
    {
      key: 'last',
      header: 'Last completed',
      cell: (gap) =>
        gap.completedOn ? (
          formatDate(gap.completedOn)
        ) : (
          <span className="text-xs text-fg-subtle">Never</span>
        ),
    },
  ];

  const recordColumns: DataTableColumn<TrainingRecord>[] = [
    {
      key: 'course',
      header: 'Course',
      cell: (record) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg">{courseTitle(record.courseId)}</p>
          <p className="truncate font-mono text-xs text-fg-subtle">{courseCode(record.courseId)}</p>
        </div>
      ),
    },
    { key: 'completed', header: 'Completed', cell: (record) => formatDate(record.completedOn) },
    {
      key: 'expires',
      header: 'Expires',
      cell: (record) =>
        record.expiresOn ? (
          formatDate(record.expiresOn)
        ) : (
          <span className="text-xs text-fg-subtle">Never</span>
        ),
    },
    {
      key: 'result',
      header: 'Result',
      cell: (record) => orDash(record.result),
      hideOnMobile: true,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (record) => (
        <StatusBadge tone={statusTone(record.status)}>{humanizeStatus(record.status)}</StatusBadge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <StatGrid>
        <StatCard
          label="Outstanding mandatory"
          value={mandatoryGaps}
          icon={AlertTriangle}
          tone="red"
          alert
          loading={gaps.isLoading}
        />
        <StatCard
          label="Current certificates"
          value={valid}
          icon={ShieldCheck}
          tone="green"
          loading={records.isLoading}
        />
        <StatCard
          label="Records held"
          value={mine.length}
          icon={GraduationCap}
          loading={records.isLoading}
        />
      </StatGrid>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          What I still need
        </h2>
        <DataTable
          columns={gapColumns}
          rows={myGaps}
          isLoading={gaps.isLoading}
          isError={gaps.isError}
          errorMessage="Failed to load your outstanding training."
          emptyMessage="Nothing outstanding — every course your position requires is current"
          emptyIcon={ShieldCheck}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          My training history
        </h2>
        <DataTable
          columns={recordColumns}
          rows={mine}
          isLoading={records.isLoading}
          isError={records.isError}
          errorMessage="Failed to load your training records."
          emptyMessage="No training recorded yet"
          emptyIcon={GraduationCap}
        />
      </section>
    </div>
  );
}
