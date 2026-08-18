/*
 * CHART COLOURS AS CSS VARIABLES, not hex.
 *
 * Six literals plus two more inside `SEVERITY_COLORS` — the light theme's palette baked into the
 * component, so every series kept its light-mode colour on a dark background. SVG `fill` and `stroke`
 * resolve `var()` exactly as Tailwind does, so these follow the theme for free. Same fix as the finops
 * pie chart.
 */
export const BLUE = 'var(--color-info)';
export const GREEN = 'var(--color-success)';
export const AMBER = 'var(--color-warning)';
export const RED = 'var(--color-danger)';
export const VIOLET = 'var(--color-violet-fg)';
export const ZINC = 'var(--color-fg-subtle)';

/**
 * Request status → colour, in the ORDER a stack should paint them.
 *
 * THE COLOURS ARE THE PRODUCT'S OWN, from the same tokens `statusTone` maps these words to — so a segment
 * in this chart is the colour of the badge for the same status everywhere else. Inventing a chart-only
 * palette would mean `approved` was green on a row and something else in the summary.
 *
 * THE ORDER IS NOT THE LIFECYCLE, and that is a deliberate, measured choice. The lifecycle order puts
 * `approved` (green) next to `rejected` (red), and adjacent green/red in a stacked bar is ΔE 4.2 for a
 * deuteranope — indistinguishable. Running the palette validator over the candidate orders, moving the
 * inert `closed` segment between the two decisions takes the worst adjacent pair to ΔE 18.2 (light) and
 * 9.5 (dark), both passing. It still reads as a pipeline: waiting, being looked at, then the outcomes.
 *
 * `cancelled` and `expired` FOLD INTO ONE SEGMENT. `statusTone` paints both neutral because they mean the
 * same thing operationally — closed with no decision and nobody to chase — and two adjacent segments of
 * identical colour read as one bar with a wrong total. The table below the chart keeps them apart.
 */
export const REQUEST_STATUS_STACK: readonly { key: string; label: string; color: string }[] = [
  { key: 'pending', label: 'Pending', color: AMBER },
  { key: 'in_review', label: 'In review', color: BLUE },
  { key: 'approved', label: 'Approved', color: GREEN },
  { key: 'closed', label: 'Cancelled / expired', color: ZINC },
  { key: 'rejected', label: 'Rejected', color: RED },
];

/** Which raw statuses the folded `closed` segment covers. */
export const CLOSED_STATUSES = ['cancelled', 'expired'] as const;

/** Severity → colour. `critical` and `high` share red, as they do in the shared tone map. */
export const SEVERITY_COLORS: Record<string, string> = {
  critical: RED,
  high: RED,
  medium: AMBER,
  low: BLUE,
};

export const DAYS_OPTIONS = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * The reporting window, as the INSTANTS the API asks for.
 *
 * FULL ISO, NOT `YYYY-MM-DD`. Every report query parameter is `z.string().datetime({ offset: true })`, and
 * this used to `.slice(0, 10)` — so every date-ranged panel on the dashboard answered 422 and rendered
 * "Failed to load data". Seven of the nine requests the screen makes: throughput, SLA, cycle time, the
 * findings donut, leave and overtime. Only the two dateless ones (queue depth, asset utilisation) worked.
 *
 * NOTHING CAUGHT IT because `shell.e2e.ts` asserts only that `/reports` renders without an error boundary,
 * and six panels each showing an error message satisfies that. `reports.e2e.ts` now asserts the panels carry
 * data, which is the assertion that fails if this regresses.
 */
export function dateRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(Date.now() - days * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** A chart axis label: `4 Mar`. Short by necessity — a full date does not fit under a tick. */
export function shortDay(iso: string) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(iso));
}

/**
 * Title-cases every word, which is what a chart legend wants.
 *
 * NOT `humanizeStatus`, deliberately: that capitalises the first letter only (`Needs improvement`),
 * which is right for a badge in a sentence and wrong for a legend entry beside other legend entries.
 * Two different jobs, so two functions rather than one with a flag.
 */
export function capitalize(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Shared card shell ─────────────────────────────────────────────────────────
