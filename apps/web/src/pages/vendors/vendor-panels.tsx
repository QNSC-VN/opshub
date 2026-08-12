import { ClipboardCheck, ShieldAlert } from 'lucide-react';
import { Badge, humanizeStatus } from '@/shared/ui';
import { formatDate, orDash } from '@/shared/lib/format';
import { outcomeTone } from './vendor.types';
import { useVendorAssessments, useVendorRisks } from './use-vendors';

/**
 * What a supplier's drawer has to answer: has anybody checked them, and what do they put at risk.
 */

/**
 * Every assessment, newest first.
 *
 * NEVER ASSESSED IS THE FINDING, not an empty list — a supplier on the register that nobody has ever
 * checked is exactly what the review-gap report exists to surface, so the empty state says that rather
 * than "no assessments".
 *
 * A CONDITIONAL PASS SHOWS ITS CONDITIONS. `pass_with_conditions` is a third outcome on purpose: a pass
 * that owes something is not a pass, and the conditions are the part somebody has to chase.
 */
export function VendorAssessmentsPanel({ vendorId }: { vendorId: string }) {
  const assessments = useVendorAssessments(vendorId);
  const rows = assessments.data ?? [];

  return (
    <div className="flex flex-col gap-2">
      {assessments.isLoading && <p className="text-xs text-fg-subtle">Loading…</p>}
      {assessments.isError && <p className="text-xs text-danger">Failed to load assessments.</p>}
      {!assessments.isLoading && !assessments.isError && rows.length === 0 && (
        <p className="text-xs text-warning">
          Never assessed — this supplier is on the register with nobody having checked them
        </p>
      )}

      {rows.map((assessment) => (
        <div
          key={assessment.id}
          className="rounded-md border border-border bg-surface px-2.5 py-2 text-xs"
        >
          <div className="flex items-center gap-1.5">
            <ClipboardCheck className="h-3.5 w-3.5 shrink-0 text-fg-subtle" strokeWidth={1.75} />
            <Badge tone={outcomeTone(assessment.outcome)}>
              {humanizeStatus(assessment.outcome)}
            </Badge>
            <span className="text-fg-subtle">{formatDate(assessment.assessedAt)}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-fg-muted">{assessment.scope}</p>
          {assessment.findings && (
            <p className="mt-1 whitespace-pre-wrap text-fg-subtle">{assessment.findings}</p>
          )}
          {/* Conditions get their own line and their own colour: they are the outstanding obligation. */}
          {assessment.conditions && (
            <p className="mt-1 whitespace-pre-wrap text-warning">
              Conditions: {assessment.conditions}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The risks this supplier introduces.
 *
 * THE ABSENCE IS THE FINDING for a critical supplier — which is what `/reports/critical-without-risk`
 * reports from the other side. Named here rather than shown as an empty list, because "no linked risks"
 * on a supplier that could stop the business is a gap and not a clean bill of health.
 */
export function VendorRisksPanel({
  vendorId,
  criticality,
}: {
  vendorId: string;
  criticality: string;
}) {
  const risks = useVendorRisks(vendorId);
  const rows = risks.data ?? [];
  const critical = criticality === 'critical' || criticality === 'high';

  return (
    <div className="flex flex-col gap-2">
      {risks.isLoading && <p className="text-xs text-fg-subtle">Loading…</p>}
      {risks.isError && <p className="text-xs text-danger">Failed to load the linked risks.</p>}
      {!risks.isLoading && !risks.isError && rows.length === 0 && (
        <p
          className={`flex items-start gap-1.5 text-xs ${critical ? 'text-warning' : 'text-fg-subtle'}`}
        >
          {critical && <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />}
          {critical
            ? 'No linked risk — a supplier at this criticality with nothing in the register is a gap the reports pick up'
            : 'No linked risks'}
        </p>
      )}

      {rows.map((risk) => (
        <div key={risk.id} className="rounded-md border border-border bg-surface px-2.5 py-1.5">
          <p className="truncate font-mono text-xs font-medium text-fg">{risk.reference}</p>
          <p className="truncate text-xs text-fg-muted">{orDash(risk.title)}</p>
        </div>
      ))}
    </div>
  );
}
