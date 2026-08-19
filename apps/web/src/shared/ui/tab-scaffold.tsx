import type { ReactNode } from 'react';
import { Button } from './button';

/**
 * The pieces a TAB inside a page needs, as opposed to a whole list page.
 *
 * `ListPage` owns the layout of a screen that is one list. A tabbed screen is different: the header
 * belongs to the page and each tab carries its own toolbar, table and actions. Workforce grew these
 * four helpers for its four tabs and said, in its own docblock, "when a second screen grows tabs like
 * these, promote them — until then, a shared component with one caller is a guess about the future".
 * Training is that second screen, with five tabs, so here they are.
 *
 * THE ACTION BUTTONS ARE `Button`s NOW. The workforce copies were raw `<button>`s with their own tone
 * map, which is the duplication the kit exists to remove — and every one of them was counted by the
 * raw-`<button>` ratchet. The tones map onto variants that already exist, so nothing here decides what
 * an accent or a danger action looks like.
 */

/** What every create-form modal in a tabbed screen takes. */
export interface FormModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/** The filter-left, action-right row above a tab's table. */
export function TabToolbar({ filter, action }: { filter: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {filter}
      {action}
    </div>
  );
}

/**
 * Cancel + submit, so no two forms disagree about button order or labels.
 *
 * WHY `pendingLabel` EXISTS. Nineteen forms wrote this footer by hand, byte-identical apart from one
 * thing: what the button says while the request is in flight. "Adding…", "Terminating…", "Assigning…",
 * "Activating…", "Working…". This component only ever said "Saving…", so a form whose verb was not
 * "save" had to open-code the whole footer to keep its wording — and then owned the button order, the
 * variants and the sizes too. One optional prop is the difference between reuse and nineteen copies.
 *
 * The pending label is the verb in progress, not a spinner: "Terminating…" on a contract termination
 * tells the user which irreversible thing is happening, where a spinner tells them only that something
 * is. Default "Saving…" because that is what most of them are.
 */
export function FormActions({
  loading,
  onClose,
  submitLabel,
  pendingLabel = 'Saving…',
  variant = 'primary',
}: {
  loading: boolean;
  onClose: () => void;
  /** A node, not a string, because several callers switch the wording on create-vs-edit. */
  submitLabel: ReactNode;
  /** What the button says in flight. The verb in progress — "Terminating…", not a spinner. */
  pendingLabel?: string;
  /** `danger` for a form whose submit destroys something — revoke, terminate. */
  variant?: 'primary' | 'danger';
}) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <Button type="button" variant="outline" size="sm" onClick={onClose}>
        Cancel
      </Button>
      <Button type="submit" variant={variant} size="sm" disabled={loading}>
        {loading ? pendingLabel : submitLabel}
      </Button>
    </div>
  );
}

/**
 * A form-level failure, announced.
 *
 * WHY THIS IS A COMPONENT AND NOT A `<p>`. Seventy-one places wrote
 * `<FormError message={error} />` — byte-identical, every one of them —
 * and not one carried `role="alert"`. So a submit that failed changed the screen and told a screen
 * reader nothing: focus stays on the button, the message appears somewhere below it, and the user is
 * left waiting for a save that already refused. The whole SPA had two `role="alert"` in it.
 *
 * `FormField` already gets this right for FIELD errors, which is what made the gap easy to miss — the
 * validation people test with a screen reader was announced, and the API refusal was not.
 *
 * `role="alert"` implies `aria-live="assertive"`, so it interrupts rather than queueing. That is the
 * right level here: the user pressed a button and is waiting for the outcome.
 */
export function FormError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs text-danger">
      {message}
    </p>
  );
}

/** The actions cell. `stopPropagation` once here rather than in every table column that has one. */
export function RowActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

/** A text action inside a row. */
export function RowAction({
  tone = 'muted',
  onClick,
  disabled,
  children,
}: {
  // `success` for an approve, which three workforce tabs offer in a row — the same vocabulary as
  // `PanelAction`, because the same decision appears in both places.
  tone?: 'accent' | 'success' | 'danger' | 'muted';
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={tone === 'muted' ? 'ghost' : tone === 'danger' ? 'danger' : 'primary'}
      onClick={onClick}
      disabled={disabled}
      // Row actions are quieter than page actions: the same variants, with no fill on the neutral one.
      className={
        tone === 'accent'
          ? 'bg-transparent text-accent hover:bg-accent-muted'
          : tone === 'success'
            ? 'bg-transparent text-success hover:bg-success-bg'
            : undefined
      }
    >
      {children}
    </Button>
  );
}

/** A slightly louder action, for a detail panel's header row rather than a table cell. */
export function PanelAction({
  tone = 'muted',
  onClick,
  disabled,
  children,
}: {
  tone?: 'accent' | 'success' | 'danger' | 'muted';
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={tone === 'danger' ? 'danger' : tone === 'muted' ? 'outline' : 'primary'}
      onClick={onClick}
      disabled={disabled}
      // `success` has no button variant of its own — an approve action is a primary action that happens
      // to be green in the badge vocabulary, and inventing a fifth variant for one caller would put the
      // decision in two places.
      className={tone === 'success' ? 'bg-success text-white hover:opacity-90' : undefined}
    >
      {children}
    </Button>
  );
}
