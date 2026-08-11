import { cn } from '@/shared/lib/utils';

/**
 * The pieces the three RBAC tabs share.
 *
 * NO LOCAL `formatDate`. This screen had its own — a third spelling of the same thing, with its own
 * locale choice — while `@/shared/lib/format` already owned it. That is the duplication the audit was
 * counting: 25 date formatters, one of which was a whole function.
 */

/** A titled panel. Three tabs, one frame. */
export function SectionCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('overflow-hidden rounded-xl border border-border bg-surface', className)}>
      {children}
    </div>
  );
}

/** The header strip inside a `SectionCard`: a title on the left, an action on the right. */
export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
