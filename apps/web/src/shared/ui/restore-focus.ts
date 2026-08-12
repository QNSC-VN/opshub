/**
 * Give focus back after an overlay closes — and never to `<body>`.
 *
 * WHY THIS IS NOT JUST `previouslyFocused.focus()`
 * -----------------------------------------------
 * The element that opened an overlay is often GONE by the time it closes, because the action it performed
 * removed it: completing a review action removes the Complete button, verifying a CAPA removes Verify. A
 * detached node cannot take focus, so focus fell to `<body>` — and a slide-over that is still open then stops
 * answering Escape, because its handler is bound to the panel and nothing inside it is focused. Measured in
 * the browser: after completing an output, Escape did nothing and the drawer could only be closed by mouse.
 *
 * So: the original element if it is still connected, otherwise the innermost overlay still on screen, so a
 * keyboard user stays where they were rather than being dropped at the top of the document.
 */
export function restoreFocus(
  previouslyFocused: HTMLElement | null,
  /**
   * The overlay that is closing, so it is not chosen as the place to put focus.
   *
   * Required rather than inferred: this runs in a cleanup, and React has not removed the closing panel from
   * the DOM yet — so without excluding it, focus goes into a node that is about to vanish and ends up on
   * `<body>` after all, which is the exact bug this function exists to fix.
   */
  closing?: HTMLElement | null,
): void {
  if (previouslyFocused?.isConnected) {
    previouslyFocused.focus();
    /*
     * AND CHECK AGAIN NEXT FRAME. Two ways this focus does not stick, both measured in the browser:
     * `focus()` is a no-op on a node that cannot take it (a disabled control, a plain `<div>`), and an
     * opener that IS connected during this cleanup is often removed by the render that follows it — the
     * Complete button disappears because the action it completed is no longer completable. Either way focus
     * lands on `<body>`, and a slide-over that is still open stops answering Escape, because its key
     * handler is bound to the panel and nothing inside it holds focus.
     */
    requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      focusInnermostOverlay(closing);
    });
    return;
  }

  focusInnermostOverlay(closing);
}

/** The overlay still on screen, so focus stays where the reader is rather than at the top of the document. */
function focusInnermostOverlay(closing?: HTMLElement | null): void {
  const overlays = [
    ...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'),
  ].filter((overlay) => !closing || (overlay !== closing && !closing.contains(overlay)));
  const innermost = overlays[overlays.length - 1];
  if (!innermost) return;

  // A focusable control inside it, if there is one — the panel itself only as a fallback, which is why it
  // carries `tabIndex={-1}`.
  const focusable = innermost.querySelector<HTMLElement>(
    'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
  );
  (focusable ?? innermost).focus();
}
