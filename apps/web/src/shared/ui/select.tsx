import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
}

/**
 * Select — a NATIVE `<select>`, styled to match `Input`.
 *
 * Native on purpose, and not a listbox built out of divs: the platform control already gives
 * keyboard support, type-ahead, an accessible name from its label, and the picker a phone or a
 * screen reader user expects. Nine raw `<select>` elements across seven pages each carried their own
 * class string, so they drifted from `Input` and from each other.
 *
 * `appearance-none` plus one chevron, because the platform arrow cannot be styled and rendering both
 * is the giveaway of a half-styled select.
 */
export function Select({ className, error, id, children, ...props }: SelectProps) {
  const errorId = error && id ? `${id}-error` : undefined;
  return (
    <div className="relative">
      <select
        id={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={errorId}
        className={cn(
          'h-9 w-full appearance-none rounded-md border bg-surface pl-3 pr-8 text-sm text-fg transition-colors focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
          error
            ? 'border-red-400 focus:border-red-400 focus:ring-red-400/20 dark:border-red-500'
            : 'border-border focus:border-accent focus:ring-accent/20',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle"
        strokeWidth={1.75}
        aria-hidden="true"
      />
    </div>
  );
}
