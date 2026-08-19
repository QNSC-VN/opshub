import { AlertTriangle, CalendarClock, Wallet } from 'lucide-react';
import { Badge, humanizeStatus, statusTone } from '@/shared/ui';
import { formatDate, formatMoney } from '@/shared/lib/format';
import { useCriticalWithoutRisk, useReviewGaps, useUnassessedSpend } from './use-vendors';

/**
 * The three questions a third-party review is actually asked, each computed by the API.
 *
 * WHY BANNERS RATHER THAN A REPORTS TAB. Each of these is a FINDING about the register the reader is
 * already looking at, and a finding on another screen is a finding nobody opens. Each renders only when it
 * has something to say — a permanently visible empty panel is one people learn to skip.
 */

/** Suppliers overdue an assessment. The interval comes from their criticality level, so the API dates it. */
export function ReviewGapsBanner() {
  const gaps = useReviewGaps();
  const rows = gaps.data ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-warning bg-warning-bg/40 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
        <CalendarClock className="h-3.5 w-3.5" strokeWidth={2} />
        {rows.length} supplier(s) are overdue an assessment
      </p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {rows.slice(0, 5).map((gap) => (
          <li key={gap.id} className="text-xs text-fg-muted">
            <span className="font-mono">{gap.reference}</span> · {gap.name}
            <Badge tone={statusTone(gap.criticality)}>{humanizeStatus(gap.criticality)}</Badge>
            {/* `daysOverdue` is the API's, and `lastAssessedAt: null` means never — a different and worse
                answer than "late", so it is spelled out. */}
            <span className="text-warning">
              {' '}
              {gap.lastAssessedAt
                ? `— ${gap.daysOverdue ?? 0} days overdue (last ${formatDate(gap.lastAssessedAt)})`
                : '— never assessed'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Critical suppliers with nothing in the risk register. The same shape as the SoA's untreated risks. */
export function CriticalWithoutRiskBanner() {
  const vendors = useCriticalWithoutRisk();
  const rows = vendors.data ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-danger bg-danger-bg/40 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-danger">
        <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
        {rows.length} critical supplier(s) have no risk on the register
      </p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {rows.slice(0, 5).map((vendor) => (
          <li key={vendor.id} className="text-xs text-fg-muted">
            <span className="font-mono">{vendor.reference}</span> · {vendor.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Money going to suppliers nobody has assessed.
 *
 * Joined from software licences by the vendor TEXT on the licence, so it also catches licences whose
 * supplier was never linked to the register at all — which is the more common gap. Cost is per seat, so
 * the line shows the seats too rather than implying a total nobody calculated.
 */
export function UnassessedSpendBanner() {
  const spend = useUnassessedSpend();
  const rows = spend.data ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-surface-muted px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-fg">
        <Wallet className="h-3.5 w-3.5" strokeWidth={2} />
        {rows.length} licence(s) are paid to suppliers with no assessment
      </p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {rows.slice(0, 5).map((row) => (
          <li key={row.licenseId} className="text-xs text-fg-muted">
            {row.licenseName}
            <span className="text-fg-subtle">
              {' '}
              · {row.vendorText}
              {/* No `vendorId` means the licence names a supplier that is not on the register — worth
                  distinguishing from one that is registered but unassessed. */}
              {!row.vendorId && ' (not on the register)'}
              {row.costPerSeatCents != null &&
                ` · ${formatMoney(row.costPerSeatCents)}/seat${
                  row.seatCount != null ? ` × ${row.seatCount}` : ''
                }`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
