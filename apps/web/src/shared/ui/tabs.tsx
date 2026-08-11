/**
 * Tabs — the underlined tab bar, with the keyboard behaviour the hand-rolled copies did not have.
 *
 * Two pages (compliance, workforce) each wrote their own: the same `-mb-px flex gap-6` bar of
 * `<button>`s with the same active `border-b-2` treatment, and in both cases no ARIA at all. That
 * matters more than the duplication does — without `role="tablist"`, a screen reader announces a row
 * of unrelated buttons and gives no clue that the content below belongs to the selected one, and
 * arrow keys do nothing.
 *
 * WHAT THIS OWNS
 *   * `role="tablist"` / `role="tab"` / `aria-selected`, and `aria-controls` pointing at the panel.
 *   * ARROW-KEY NAVIGATION, wrapping at both ends, plus Home/End — the pattern the WAI-ARIA tabs
 *     guidance describes, and the one a keyboard user will try first.
 *   * A ROVING TAB INDEX: only the selected tab is a tab stop, so Tab moves past the bar into the
 *     panel instead of walking every tab on the way.
 *
 * The panel is the page's own markup — this renders the bar and tells the caller which value is
 * selected. Wrapping the content too would mean either mounting every panel (and firing every query
 * behind them) or unmounting the inactive ones and losing their state, and that is a decision each
 * screen should keep.
 */
import { useRef, type ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

export interface TabItem<V extends string> {
  value: V;
  label: string;
  /** A count, or an "Upgrade" pill — rendered after the label. */
  badge?: ReactNode;
}

export interface TabsProps<V extends string> {
  items: TabItem<V>[];
  value: V;
  onChange: (value: V) => void;
  /**
   * Id prefix for `aria-controls`. The panel must carry `id={`${idPrefix}-panel-${value}`}` and
   * `role="tabpanel"`, which `TabPanel` below does for you.
   */
  idPrefix: string;
  className?: string;
}

export function Tabs<V extends string>({
  items,
  value,
  onChange,
  idPrefix,
  className,
}: TabsProps<V>) {
  const barRef = useRef<HTMLDivElement>(null);

  function move(delta: number) {
    const index = items.findIndex((i) => i.value === value);
    // Wraps deliberately: the guidance says a tab list is a loop, and stopping at the end makes the
    // last tab feel broken.
    const next = items[(index + delta + items.length) % items.length];
    onChange(next.value);
    focusTab(next.value);
  }

  function focusTab(v: V) {
    barRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${v}"]`)?.focus();
  }

  return (
    <div className={cn('border-b border-border', className)}>
      <div
        ref={barRef}
        role="tablist"
        className="-mb-px flex gap-6 overflow-x-auto"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            move(1);
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            move(-1);
          } else if (e.key === 'Home') {
            e.preventDefault();
            onChange(items[0].value);
            focusTab(items[0].value);
          } else if (e.key === 'End') {
            e.preventDefault();
            const last = items[items.length - 1];
            onChange(last.value);
            focusTab(last.value);
          }
        }}
      >
        {items.map((item) => {
          const selected = item.value === value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              data-tab={item.value}
              id={`${idPrefix}-tab-${item.value}`}
              aria-selected={selected}
              aria-controls={`${idPrefix}-panel-${item.value}`}
              // Roving: the unselected tabs are reachable by arrow key, not by Tab.
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.value)}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 border-b-2 pb-3 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                selected
                  ? 'border-accent text-accent'
                  : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              {item.label}
              {item.badge}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface TabPanelProps<V extends string> {
  idPrefix: string;
  value: V;
  children: ReactNode;
}

/** The panel half of the pair: carries the id and role that `aria-controls` promises exist. */
export function TabPanel<V extends string>({ idPrefix, value, children }: TabPanelProps<V>) {
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${value}`}
      aria-labelledby={`${idPrefix}-tab-${value}`}
      // Focusable so that Tab out of the bar lands in the panel rather than skipping its content.
      tabIndex={0}
      className="focus-visible:outline-none"
    >
      {children}
    </div>
  );
}
