// @vitest-environment jsdom
/**
 * A form-level failure has to be announced, not merely displayed.
 *
 * Seventy-two places rendered `{error && <p className="text-xs text-danger">{error}</p>}` and not one
 * carried `role="alert"`; the whole SPA had two. So a submit the API refused changed the screen and told
 * a screen reader nothing — focus stays on the button, the message appears below it, and the user waits
 * for a save that already failed.
 *
 * The ratchet in `fe-consistency.ratchet.test.ts` proves nobody hand-rolls the shape any more. This
 * proves the replacement actually announces, which is the part that matters and the part a grep cannot
 * check.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormError } from './tab-scaffold';

describe('FormError', () => {
  it('announces the message through an alert role', () => {
    render(<FormError message="Contract has no signature date." />);

    /*
     * `getByRole('alert')` rather than a text query on purpose: finding the text proves it rendered,
     * and only the ROLE proves it is announced. `role="alert"` implies `aria-live="assertive"`, which
     * interrupts rather than queueing — the right level when somebody pressed a button and is waiting.
     */
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Contract has no signature date.');
  });

  it('renders nothing at all when there is no message', () => {
    const { container } = render(<FormError message={undefined} />);

    // Not an empty alert region: a live region that exists but is empty can be announced as a change
    // when it later fills AND when it is created, and an empty paragraph still occupies layout above a
    // form's actions.
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('treats an empty string as no message', () => {
    // `useState('')` is how every one of these call sites initialises its error, so the empty string is
    // the common case and must not produce an empty alert on first render.
    const { container } = render(<FormError message="" />);
    expect(container).toBeEmptyDOMElement();
  });
});
