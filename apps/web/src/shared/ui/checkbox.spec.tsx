// @vitest-environment jsdom
/**
 * The checkbox, and the one thing that differed between the five hand-rolled copies.
 *
 * Four of them shared an identical class string. The fifth — the attendance widget — had drifted to
 * `border-border accent-accent` with no `focus:ring` at all, so it was the one checkbox in the product
 * with no visible keyboard focus. That is invisible to a reader and unmissable to anyone tabbing.
 *
 * The other property worth pinning is that the LABEL is part of the control. Every hand-rolled copy
 * wrapped the input in its `<label>`, so clicking the text toggled the box; a component that rendered
 * the label as a sibling would look identical and lose that.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from './checkbox';

describe('Checkbox', () => {
  it('toggles when the label text is clicked, not only the box', () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="Working remotely" />);

    // The text is the hit target because the input lives inside the `<label>`. This is what every
    // hand-rolled copy got right and what a sibling-label component would silently break.
    fireEvent.click(screen.getByText('Working remotely'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('reports the unchecking as false rather than just firing', () => {
    const onChange = vi.fn();
    render(<Checkbox checked onChange={onChange} label="Holds personal data" />);

    fireEvent.click(screen.getByRole('checkbox'));
    // The callback takes the NEXT value, so a caller never has to invert it themselves — four of the
    // five call sites were doing `e.target.checked` by hand.
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('keeps a visible focus ring at every size', () => {
    const { rerender, container } = render(
      <Checkbox checked={false} onChange={vi.fn()} label="x" />,
    );
    expect(container.querySelector('input')?.className).toContain('focus:ring-accent');

    rerender(<Checkbox size="sm" checked={false} onChange={vi.fn()} label="x" />);
    /*
     * THE DRIFT, AS A TEST. The compact copy is the one that lost its ring, so `sm` is exactly where a
     * future size variant would be tempted to drop it again. The size changes; the ring does not.
     */
    const input = container.querySelector('input');
    expect(input?.className).toContain('focus:ring-accent');
    expect(input?.className).toContain('h-3.5');
    // And the token, not a literal colour: `accent-accent` had no dark-mode behaviour of its own.
    expect(input?.className).not.toContain('accent-accent');
  });

  it('puts the hint inside the label, so it is part of the accessible name', () => {
    render(
      <Checkbox
        checked={false}
        onChange={vi.fn()}
        label="Personal data was or may have been exposed"
        hint="Starts the 72-hour notification clock."
      />,
    );

    /*
     * For the breach flag the hint IS the consequence — a GDPR Article 33 deadline. Rendered outside
     * the label it would be text near a control rather than part of what the control says it does, and
     * a screen reader would announce the flag without the deadline.
     */
    const checkbox = screen.getByRole('checkbox', {
      name: /Personal data was or may have been exposed.*72-hour notification clock/s,
    });
    expect(checkbox).toBeInTheDocument();
  });

  it('aligns the box to the first line when the label wraps', () => {
    const { container } = render(
      <Checkbox align="start" checked={false} onChange={vi.fn()} label="a long wrapping label" />,
    );
    // `items-start` plus `mt-0.5` on the input: centred against a three-line label puts the box in the
    // middle of the paragraph, which reads as unrelated to it.
    expect(container.querySelector('label')?.className).toContain('items-start');
    expect(container.querySelector('input')?.className).toContain('mt-0.5');
  });

  it('marks itself disabled, and says so visually', () => {
    const { container } = render(
      <Checkbox disabled checked={false} onChange={vi.fn()} label="x" />,
    );

    /*
     * ASSERTED ON THE ATTRIBUTE, not by clicking. A real browser fires no click on a disabled input, so
     * the attribute IS the guarantee — but jsdom dispatches the event anyway and React's synthetic
     * handler runs, so a "does not fire" assertion here would be testing jsdom rather than the
     * component. I wrote that version first and it failed for exactly that reason.
     */
    expect(screen.getByRole('checkbox')).toBeDisabled();
    // And the label carries the cue, so the state is visible rather than only discovered by clicking.
    expect(container.querySelector('label')?.className).toContain('cursor-not-allowed');
  });
});
