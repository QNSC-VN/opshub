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
 * NESTING IS RESOLVED BY STACKING LAYER, NOT BY DOCUMENT ORDER
 * ------------------------------------------------------------
 * It was document order — the last open `aria-modal` dialog owned Escape — and that is wrong for the way
 * every screen here is built. Pages render their dialogs at page level and their drawer LAST, deliberately:
 * a dialog rendered inside the drawer's subtree is unmounted the moment the drawer closes, which is also
 * the moment its own action closes the drawer. So the drawer is the last such element in the document while
 * a modal sits on top of it, and one Escape closed the thing UNDERNEATH: the modal stayed, over a drawer
 * that had gone. The same DOM-order assumption put those modals behind the drawer visually until `Modal`
 * was raised to `z-[60]`; this is that bug's other half.
 *
 * So each overlay advertises the layer it stacks on, mirroring the `z-` class it already carries, and the
 * highest layer owns Escape. Document order remains the tie-break between two overlays on one layer.
 */
export const OVERLAY_LAYER = {
  /** `SlideOver` — `z-50`. */
  drawer: 50,
  /** `Modal` and `ConfirmDialog` — `z-[60]`, above any drawer they were opened from. */
  dialog: 60,
} as const;

/**
 * Both dialog roles, because a `ConfirmDialog` is an `alertdialog`.
 *
 * Querying only `role="dialog"` made confirmations invisible here, so Escape over one closed the
 * confirmation (through its own key handler) AND the drawer behind it — one keypress, two overlays, and the
 * drawer gone from under a decision nobody had made yet.
 */
const OVERLAY_SELECTOR =
  '[aria-modal="true"][role="dialog"],[aria-modal="true"][role="alertdialog"]';

function layerOf(element: Element): number {
  return Number(element.getAttribute('data-overlay-layer') ?? 0);
}

export function useEscapeToClose(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) return;

    function handle(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;

      const overlays = Array.from(document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR));
      // `>=`, so equal layers fall back to the LAST in document order — the previous behaviour, kept for
      // the case it was actually right about.
      const top = overlays.reduce(
        (best, element) => (layerOf(element) >= layerOf(best) ? element : best),
        overlays[0],
      );
      // Not this one? Something is stacked on top of it, and Escape belongs to that.
      if (top !== panelRef.current) return;

      event.stopPropagation();
      onClose();
    }

    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [open, panelRef, onClose]);
}
