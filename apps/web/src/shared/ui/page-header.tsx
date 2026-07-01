import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Right-aligned actions (primary button, status pill, etc.). */
  actions?: ReactNode;
  className?: string;
}

/** Standard page title block. Used at the top of every route. */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
