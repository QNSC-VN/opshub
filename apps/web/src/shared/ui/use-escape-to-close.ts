import { useEffect, type RefObject } from 'react';

/**
 * Escape closes the INNERMOST overlay, wherever focus happens to be.
 *
 * WHY THIS IS ON THE DOCUMENT AND NOT ON THE PANEL
 * ------------------------------------------------
 * Both overlays used to bind Escape with React's `onKeyDown` on their own panel, which only fires when focus
 * is inside it. That is true right after opening — and false again as soon as anything removes the focused
 * control, which actions routinely do: completing a review output removes the Complete button that opened its
 * modal. Focus falls to `<body>`, and a slide-over still filling half the screen stops answering Escape.
 * Measured in the browser, then again under parallel load, where restoring focus one frame later was not
 * quick enough to be relied on.
 *
 * NESTING IS RESOLVED BY DOCUMENT ORDER: the last open `aria-modal` dialog owns Escape, so a modal launched
 * from a drawer closes itself and leaves the drawer open — which is what a reader expects from one keypress.
 */
export function useEscapeToClose(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) return;

    function handle(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;

      const overlays = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
      // Not this one? Something is stacked on top of it, and Escape belongs to that.
      if (overlays[overlays.length - 1] !== panelRef.current) return;

      event.stopPropagation();
      onClose();
    }

    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [open, panelRef, onClose]);
}
