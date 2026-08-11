import type { TextareaHTMLAttributes } from 'react';
import { cn } from '@/shared/lib/utils';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
}

/**
 * Textarea — `Input`'s twin, and deliberately identical in API and error treatment.
 *
 * Eight pages wrote the same class string inline. They agreed on the border and the focus ring by
 * luck rather than by construction, and none of them wired `aria-invalid`/`aria-describedby`, so a
 * field with an error looked wrong and announced nothing.
 */
export function Textarea({ className, error, id, rows = 3, ...props }: TextareaProps) {
  const errorId = error && id ? `${id}-error` : undefined;
  return (
    <textarea
      id={id}
      rows={rows}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={errorId}
      className={cn(
        'w-full resize-none rounded-md border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle transition-colors focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
        error
          ? 'border-red-400 focus:border-red-400 focus:ring-red-400/20 dark:border-red-500'
          : 'border-border focus:border-accent focus:ring-accent/20',
        className,
      )}
      {...props}
    />
  );
}
