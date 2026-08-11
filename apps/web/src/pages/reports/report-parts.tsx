import type { ReactNode } from 'react';

/**
 * The panel frame the charts sit in, plus their loading and error states.
 *
 * Components only — the colours, ranges and formatters live in `report-config.ts`, because a file that
 * exports both loses Fast Refresh for the components (eslint's `react-refresh/only-export-components`,
 * the same lesson as workforce and rbac).
 */

export function Card({
  title,
  children,
  className = '',
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-border bg-surface ${className}`}>
      <div className="border-b border-border px-5 py-3.5">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export function ChartSkeleton() {
  return <div className="h-48 animate-pulse rounded-lg bg-surface-muted" />;
}

export function ErrorMsg() {
  return <p className="py-4 text-center text-xs text-danger">Failed to load data</p>;
}

// ── Section 1: Throughput area chart ──────────────────────────────────────────
