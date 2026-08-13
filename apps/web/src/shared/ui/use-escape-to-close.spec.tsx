// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { useEscapeToClose } from './use-escape-to-close';

/**
 * Escape belongs to the innermost overlay, and works from anywhere on the page.
 *
 * Both properties were broken by the panel-scoped handler these replace: pressing Escape while focus sat on
 * `<body>` did nothing, which is the state the page reaches whenever an action removes the control that was
 * focused.
 */

function Overlay({
  id,
  open = true,
  onClose,
  layer,
  role = 'dialog',
}: {
  id: string;
  open?: boolean;
  onClose: () => void;
  layer?: number;
  role?: 'dialog' | 'alertdialog';
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEscapeToClose(open, ref, onClose);
  return (
    <div
      ref={ref}
      data-testid={id}
      data-overlay-layer={layer}
      role={role}
      aria-modal="true"
      tabIndex={-1}
    >
      {id}
    </div>
  );
}

function pressEscape() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

describe('useEscapeToClose', () => {
  it('closes when Escape is pressed with focus outside the panel', () => {
    const onClose = vi.fn();
    render(<Overlay id="drawer" onClose={onClose} />);
    document.body.focus();

    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores keys that are not Escape', () => {
    const onClose = vi.fn();
    render(<Overlay id="drawer" onClose={onClose} />);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('gives Escape to the INNERMOST overlay only', () => {
    const closeDrawer = vi.fn();
    const closeModal = vi.fn();
    render(
      <>
        <Overlay id="drawer" onClose={closeDrawer} />
        <Overlay id="modal" onClose={closeModal} />
      </>,
    );
    expect(screen.getByTestId('modal')).toBeTruthy();

    pressEscape();
    // One keypress, one overlay: the modal closes and the drawer behind it stays.
    expect(closeModal).toHaveBeenCalledTimes(1);
    expect(closeDrawer).not.toHaveBeenCalled();
  });

  /**
   * THE ORDER ABOVE IS THE ONE PAGES DO NOT USE, which is how this went unnoticed.
   *
   * Every screen in the SPA renders its dialogs at page level and its drawer last — deliberately, because a
   * dialog rendered inside the drawer's subtree dies with the drawer. So the DRAWER is the last
   * `aria-modal` element in the document while a modal sits on top of it, and a document-order tie-break
   * handed Escape to the thing underneath: the modal stayed open over a drawer that had just closed.
   *
   * The layer decides, and it mirrors the `z-` class each overlay already carries. Document order is still
   * the tie-break, for two overlays on the same layer.
   */
  it('gives Escape to the higher LAYER even when it renders first', () => {
    const closeDrawer = vi.fn();
    const closeModal = vi.fn();
    render(
      <>
        <Overlay id="modal" layer={60} onClose={closeModal} />
        <Overlay id="drawer" layer={50} onClose={closeDrawer} />
      </>,
    );

    pressEscape();
    expect(closeModal).toHaveBeenCalledTimes(1);
    expect(closeDrawer).not.toHaveBeenCalled();
  });

  /**
   * A `ConfirmDialog` is an `alertdialog`, and it was invisible to this hook.
   *
   * It closes itself on Escape through its own key handler, so the keypress used to close BOTH it and the
   * drawer it was opened from — one keypress, two overlays, and the drawer gone from under a decision that
   * had not been made yet.
   */
  it('lets an alertdialog above a drawer keep Escape to itself', () => {
    const closeDrawer = vi.fn();
    const closeConfirm = vi.fn();
    render(
      <>
        <Overlay id="confirm" role="alertdialog" layer={60} onClose={closeConfirm} />
        <Overlay id="drawer" layer={50} onClose={closeDrawer} />
      </>,
    );

    pressEscape();
    expect(closeConfirm).toHaveBeenCalledTimes(1);
    expect(closeDrawer).not.toHaveBeenCalled();
  });

  it('does nothing while closed, so a hidden panel cannot swallow the key', () => {
    const onClose = vi.fn();
    render(<Overlay id="drawer" open={false} onClose={onClose} />);
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });
});
