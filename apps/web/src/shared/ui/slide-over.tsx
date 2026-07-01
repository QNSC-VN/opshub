/**
 * SlideOver — accessible right-side panel.
 *
 * Patterns:
 *  - ARIA: role=dialog, aria-modal, aria-labelledby/describedby
 *  - Focus trap: on open, focus first focusable element; Tab cycles within panel
 *  - Keyboard: Escape closes
 *  - Backdrop: click outside closes
 *  - Animation: CSS translate (GPU-composited, no layout thrash)
 *  - Zero runtime dependencies beyond React
 */
import {
  useEffect,
  useRef,
  useId,
  type ReactNode,
  type KeyboardEvent,
} from 'react';
import { X } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** Additional header actions rendered next to the close button. */
  headerActions?: ReactNode;
  children: ReactNode;
  /** Optional sticky footer, e.g. Save / Cancel buttons. */
  footer?: ReactNode;
  /** Panel width. Defaults to 'md'. */
  width?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
}

// ── Constants ─────────────────────────────────────────────────────────────────

const WIDTH: Record<NonNullable<SlideOverProps['width']>, string> = {
  sm:  'w-80',
  md:  'w-[420px]',
  lg:  'w-[520px]',
  xl:  'w-[640px]',
  '2xl': 'w-[768px]',
};

/** All focusable element selectors per WCAG 2.1. */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// ── Component ─────────────────────────────────────────────────────────────────

export function SlideOver({
  open,
  onClose,
  title,
  description,
  headerActions,
  children,
  footer,
  width = 'md',
}: SlideOverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId  = useId();
  const descId   = useId();

  // ── Focus trap ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;

    // Save previously-focused element to restore on close
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus first focusable element in the panel
    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelectorAll<HTMLElement>(FOCUSABLE)[0];
      first?.focus();
    }

    return () => {
      previouslyFocused?.focus();
    };
  }, [open]);

  // ── Body scroll lock ──────────────────────────────────────────────────────

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // ── Keyboard handler ──────────────────────────────────────────────────────

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }

    if (e.key !== 'Tab') return;

    const panel = panelRef.current;
    if (!panel) return;

    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last  = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Portal backdrop */}
      <div
        aria-hidden="true"
        className={cn(
          'fixed inset-0 z-40 bg-[var(--overlay)] backdrop-blur-[2px] transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        onKeyDown={handleKeyDown}
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex flex-col',
          'bg-surface shadow-2xl ring-1 ring-border',
          'transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
          WIDTH[width],
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="truncate text-sm font-semibold text-fg"
            >
              {title}
            </h2>
            {description && (
              <p
                id={descId}
                className="mt-0.5 truncate text-xs text-fg-muted"
              >
                {description}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close panel"
              className="flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>

        {/* Optional footer */}
        {footer && (
          <div className="shrink-0 border-t border-border px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </>
  );
}

// ── Section helper ────────────────────────────────────────────────────────────

/** Labeled section inside a SlideOver body. */
export function SlideOverSection({
  title,
  className,
  children,
}: {
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('px-5 py-4', className)}>
      {title && (
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-fg-subtle">
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}
