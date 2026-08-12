// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { restoreFocus } from './restore-focus';

/**
 * The focus rule after an overlay closes, pinned because the failure it fixes is silent.
 *
 * A detached opener cannot take focus, and focus landing on `<body>` looks like nothing at all — until a
 * keyboard user finds that Escape no longer closes the slide-over they are still looking at.
 */
/** One animation frame, which is when the second check runs. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe('restoreFocus', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns focus to the opener when it is still on the page', () => {
    document.body.innerHTML = '<button id="opener">Complete</button>';
    const opener = document.getElementById('opener') as HTMLElement;
    restoreFocus(opener);
    expect(document.activeElement).toBe(opener);
  });

  it('keeps focus inside the still-open overlay when the opener has been removed', () => {
    // The real shape: a slide-over stays open, and the action removed the button that opened the modal.
    document.body.innerHTML = `
      <div role="dialog" aria-modal="true" tabindex="-1" id="drawer">
        <button id="inside">Raise an output</button>
      </div>`;
    const detached = document.createElement('button');
    expect(detached.isConnected).toBe(false);

    restoreFocus(detached);
    expect(document.activeElement).toBe(document.getElementById('inside'));
  });

  it('falls back to the overlay itself when nothing inside it can take focus', () => {
    document.body.innerHTML =
      '<div role="dialog" aria-modal="true" tabindex="-1" id="drawer">No controls</div>';
    restoreFocus(document.createElement('button'));
    expect(document.activeElement).toBe(document.getElementById('drawer'));
  });

  it('falls through when the opener is on the page but cannot take focus', async () => {
    // `isConnected` is not `focusable`: a disabled button stays in the document and swallows `focus()`.
    document.body.innerHTML = `
      <div role="dialog" aria-modal="true" tabindex="-1" id="drawer"><button id="stay">stay</button></div>
      <button id="dead" disabled>Complete</button>`;
    restoreFocus(document.getElementById('dead') as HTMLElement);

    await nextFrame();
    expect(document.activeElement).toBe(document.getElementById('stay'));
  });

  it('recovers when the opener is removed by the render that follows', async () => {
    /*
     * The browser's actual sequence: the Complete button is still connected during the modal's cleanup, and
     * the re-render prompted by the invalidation removes it a moment later. Focus silently becomes `<body>`.
     */
    document.body.innerHTML = `
      <div role="dialog" aria-modal="true" tabindex="-1" id="drawer"><button id="stay">stay</button></div>
      <button id="opener">Complete</button>`;
    const opener = document.getElementById('opener') as HTMLElement;
    restoreFocus(opener);
    expect(document.activeElement).toBe(opener);

    opener.remove();
    await nextFrame();
    expect(document.activeElement).toBe(document.getElementById('stay'));
  });

  it('never puts focus into the overlay that is closing', () => {
    /*
     * The case the browser hit. React has not removed the closing modal from the DOM when this runs, so
     * without the exclusion focus goes into it and lands on `<body>` a tick later — leaving the drawer
     * behind it open and unable to answer Escape.
     */
    document.body.innerHTML = `
      <div role="dialog" aria-modal="true" tabindex="-1" id="drawer"><button id="stay">stay</button></div>
      <div role="dialog" aria-modal="true" tabindex="-1" id="modal"><button id="going">going</button></div>`;
    const closing = document.getElementById('modal') as HTMLElement;

    restoreFocus(document.createElement('button'), closing);
    expect(document.activeElement).toBe(document.getElementById('stay'));
  });

  it('picks the INNERMOST overlay when two are open', () => {
    document.body.innerHTML = `
      <div role="dialog" aria-modal="true" tabindex="-1" id="outer"><button id="a">a</button></div>
      <div role="dialog" aria-modal="true" tabindex="-1" id="inner"><button id="b">b</button></div>`;
    restoreFocus(null);
    expect(document.activeElement).toBe(document.getElementById('b'));
  });
});
