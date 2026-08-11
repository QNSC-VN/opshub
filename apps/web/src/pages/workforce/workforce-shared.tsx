import type { ReactNode } from 'react';
import { Button } from '@/shared/ui';

/**
 * The pieces the four workforce tabs share.
 *
 * Local to this screen rather than in `shared/ui`: `ListPage` already owns the toolbar for a whole
 * page, and these are tabs INSIDE one page. When a second screen grows tabs like these, promote
 * them — until then, a shared component with one caller is a guess about the future.
 */

export interface FormModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/** The filter-left, action-right row above each tab's table. Four identical copies, now one. */
export function TabToolbar({ filter, action }: { filter: ReactNode; action: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {filter}
      {action}
    </div>
  );
}

/** Cancel + submit, so four forms cannot disagree about button order or labels. */
export function FormActions({
  loading,
  onClose,
  submitLabel,
}: {
  loading: boolean;
  onClose: () => void;
  submitLabel: string;
}) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <Button type="button" variant="outline" size="sm" onClick={onClose}>
        Cancel
      </Button>
      <Button type="submit" variant="primary" size="sm" disabled={loading}>
        {loading ? 'Saving…' : submitLabel}
      </Button>
    </div>
  );
}

/** The actions cell. `stopPropagation` once here rather than in four table columns. */
export function RowActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

const ACTION_TONE = {
  accent: 'text-accent hover:bg-accent-muted',
  success: 'text-success hover:bg-success-bg',
  danger: 'text-danger hover:bg-danger-bg',
  muted: 'text-fg-muted hover:bg-surface-hover',
} as const;

export function RowAction({
  tone,
  onClick,
  children,
}: {
  tone: keyof typeof ACTION_TONE;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2 py-1 text-xs font-medium transition-colors ${ACTION_TONE[tone]}`}
    >
      {children}
    </button>
  );
}

const PANEL_TONE = {
  accent: 'bg-accent-muted text-accent',
  success: 'bg-success-bg text-success',
  danger: 'bg-danger-bg text-danger',
  muted: 'border border-border text-fg-muted hover:bg-surface-hover',
} as const;

export function PanelAction({
  tone,
  onClick,
  children,
}: {
  tone: keyof typeof PANEL_TONE;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${PANEL_TONE[tone]}`}
    >
      {children}
    </button>
  );
}
