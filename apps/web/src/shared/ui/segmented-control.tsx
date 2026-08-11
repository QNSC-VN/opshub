/**
 * SegmentedControl — the pill row six pages use to filter a list by one value.
 *
 * Six copies existed (compliance, access, workforce, people, rbac, requests), all the same
 * `rounded-lg bg-surface-muted p-1` strip of buttons with the same active `bg-surface shadow-sm`,
 * and none of them told an assistive technology what the row WAS: just buttons, with no indication
 * that they are alternatives or which one is in force.
 *
 * `role="radiogroup"` and `aria-checked`, because that is what this is — one choice out of a small
 * fixed set, always exactly one selected. A row of `aria-pressed` toggles would say the wrong thing:
 * it implies each is independently on or off, which is how a multi-select filter behaves.
 *
 * Arrow keys move between options, as they do in a real radio group. The label is required rather
 * than optional: "All / Critical / High / Medium / Low" is meaningless read aloud without knowing it
 * filters by severity, and six of those rows on one screen would be indistinguishable.
 */
import { useRef } from 'react';
import { cn } from '@/shared/lib/utils';

export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
}

export interface SegmentedControlProps<V extends string> {
  /** Announced as the group's name — "Filter by severity", not "All Critical High". */
  label: string;
  options: SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  className?: string;
}

export function SegmentedControl<V extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<V>) {
  const groupRef = useRef<HTMLDivElement>(null);

  function move(delta: number) {
    const index = options.findIndex((o) => o.value === value);
    const next = options[(index + delta + options.length) % options.length];
    onChange(next.value);
    groupRef.current?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus();
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      className={cn('flex w-fit gap-1 rounded-lg bg-surface-muted p-1', className)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          move(1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            data-value={option.value}
            aria-checked={selected}
            // Roving tab index, so the group is one tab stop rather than five.
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-md px-3 py-1 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              selected ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
