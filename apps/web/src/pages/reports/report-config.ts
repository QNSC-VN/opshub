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

export function dateRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(Date.now() - days * 86_400_000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
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
