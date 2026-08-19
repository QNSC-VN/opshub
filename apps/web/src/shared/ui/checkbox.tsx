import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

/**
 * A checkbox with its label, as one control.
 *
 * WHY THIS IS IN THE KIT. Five places built the same thing by hand — a `<label>` with `cursor-pointer
 * select-none`, a native `<input type="checkbox">`, and a text span — and the kit had `Input`, `Select`,
 * `Textarea` and `FormField` but nothing for the one control that carries a legal flag ("personal data
 * was or may have been exposed", which starts a GDPR Article 33 clock).
 *
 * Four of the five shared an identical class string. The fifth, the attendance widget, had drifted to
 * `border-border accent-accent` with no `focus:ring` at all — so that checkbox had no visible keyboard
 * focus, which is the one difference between the five that a reader would never notice and a keyboard
 * user cannot miss. Unifying the tokens is the point; the size difference was deliberate and is kept.
 *
 * NATIVE `<input>`, not a div with a role. The platform control already gives the space-bar toggle, the
 * indeterminate state, form participation, and the checkbox affordance a screen reader announces. Same
 * reasoning as `Select` being a native `<select>` here.
 *
 * The whole thing is inside the `<label>`, so the label text is the hit target — clicking "Working
 * remotely" toggles it, which is what every one of the five hand-rolled versions already got right.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  align = 'center',
  size = 'md',
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The clickable label. A node, not a string, because one caller puts an icon beside the text. */
  label: ReactNode;
  /**
   * Secondary line under the label — the consequence of ticking it.
   *
   * Rendered inside the same `<label>`, so it is part of the accessible name rather than orphaned
   * text beside the control. For the breach flag that consequence is a notification deadline, which
   * is not optional detail.
   */
  hint?: ReactNode;
  /** `start` when the label wraps to more than one line, so the box aligns to the first line. */
  align?: 'center' | 'start';
  /** `sm` for compact widget contexts — the attendance clock, not a form. */
  size?: 'sm' | 'md';
  disabled?: boolean;
  id?: string;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer select-none gap-2.5',
        align === 'start' ? 'items-start' : 'items-center',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className={cn(
          // `border-border-strong` and `focus:ring-accent` on every size: the ring is what the drifted
          // copy was missing, and a control you cannot see focus on is not keyboard-operable.
          'rounded border-border-strong text-accent focus:ring-accent',
          size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4',
          align === 'start' && 'mt-0.5',
        )}
      />
      <span className={cn(size === 'sm' ? 'text-xs' : 'text-sm', 'text-fg-muted')}>
        {label}
        {hint && <span className="block text-xs text-fg-subtle">{hint}</span>}
      </span>
    </label>
  );
}
