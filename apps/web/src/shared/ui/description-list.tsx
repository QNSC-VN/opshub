import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

export interface DescriptionItem {
  label: string;
  /** `null`/`undefined` renders the em dash, so callers stop writing `?? '—'` at every site. */
  value: ReactNode;
  /** Span both columns — for a long note or a list of chips. */
  wide?: boolean;
}

export interface DescriptionListProps {
  items: DescriptionItem[];
  /** One column on a narrow panel; two is the default a detail slide-over uses. */
  columns?: 1 | 2;
  className?: string;
}

/**
 * DescriptionList — the label/value grid every detail panel shows.
 *
 * Twelve copies across nine pages, all the same `grid grid-cols-2 gap-x-4 gap-y-3` of `dt`/`dd`
 * pairs, several of them built by mapping an inline array — which is this component with the
 * component part left out. Each also spelled its own `?? '—'`, so a missing value showed as a dash
 * in most places and as blank space in the rest.
 *
 * Real `<dl>`/`<dt>`/`<dd>` rather than divs, because that is what a list of label/value pairs is:
 * a screen reader can then read "Software, Nginx" as a pair instead of as two unrelated lines.
 */
export function DescriptionList({ items, columns = 2, className }: DescriptionListProps) {
  return (
    <dl
      className={cn(
        'grid gap-x-4 gap-y-3 text-sm',
        columns === 2 ? 'grid-cols-2' : 'grid-cols-1',
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className={item.wide ? 'col-span-full' : undefined}>
          <dt className="text-xs text-fg-subtle">{item.label}</dt>
          <dd className="mt-0.5 text-fg">
            {item.value === null || item.value === undefined || item.value === ''
              ? '—'
              : item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
