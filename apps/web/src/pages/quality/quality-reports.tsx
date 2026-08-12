import { CalendarClock, Repeat } from 'lucide-react';
import { Badge, humanizeStatus, statusTone } from '@/shared/ui';
import { formatDate } from '@/shared/lib/format';
import { useContainmentOverdue, useRecurrence } from './use-quality';

/**
 * The two questions a management review actually asks of the quality system.
 *
 * WHY BANNERS ON THE REGISTER. Each is a finding ABOUT the register the reader is already looking at, and a
 * finding on another screen is a finding nobody opens. Each renders only when it has something to say.
 */

/**
 * Findings past their containment deadline.
 *
 * The deadline is detection plus the grade's `containmentDueDays`, both from the API's reference data — so a
 * critical finding due tomorrow and an observation due in a month are one report, not two rules in a screen.
 */
export function ContainmentOverdueBanner() {
  const overdue = useContainmentOverdue();
  const rows = overdue.data ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-warning bg-warning-bg/40 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
        <CalendarClock className="h-3.5 w-3.5" strokeWidth={2} />
        {rows.length} finding(s) are past their containment deadline
      </p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {rows.slice(0, 5).map((row) => (
          <li key={row.id} className="text-xs text-fg-muted">
            <span className="font-mono">{row.reference}</span> · {row.title}
            <Badge tone={statusTone(row.severity)}>{humanizeStatus(row.severity)}</Badge>
            <span className="text-warning">
              {' '}
              — {row.daysOverdue} day(s) overdue (due {formatDate(row.dueOn)})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Process areas where a finding came back after a CAPA there was verified effective.
 *
 * THIS IS THE REPORT THE MODULE EXISTS TO PRODUCE. Every other number says work happened; this one asks
 * whether the work worked, and a recurrence is direct evidence that a root cause was never the root cause.
 * Both dates show because the claim is the ORDER of them: verified, then it happened again.
 */
export function RecurrenceBanner() {
  const recurrence = useRecurrence();
  const rows = recurrence.data ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-danger bg-danger-bg/40 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-danger">
        <Repeat className="h-3.5 w-3.5" strokeWidth={2} />
        {rows.length} process area(s) had a finding recur after a CAPA was verified effective
      </p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {rows.slice(0, 5).map((row) => (
          <li key={row.processArea} className="text-xs text-fg-muted">
            {row.processArea}
            <span className="text-fg-subtle">
              {' '}
              · {row.findings} finding(s), {row.verifiedCapas} verified CAPA(s)
            </span>
            <span className="text-danger">
              {' '}
              — verified {formatDate(row.earlierCapaVerifiedAt)}, recurred{' '}
              {formatDate(row.latestDetectedAt)} (
              <span className="font-mono">{row.latestReference}</span>)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
