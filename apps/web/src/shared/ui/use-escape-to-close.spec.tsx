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
}: {
  id: string;
  open?: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEscapeToClose(open, ref, onClose);
  return (
    <div ref={ref} data-testid={id} role="dialog" aria-modal="true" tabIndex={-1}>
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

  it('does nothing while closed, so a hidden panel cannot swallow the key', () => {
    const onClose = vi.fn();
    render(<Overlay id="drawer" open={false} onClose={onClose} />);
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });
});
