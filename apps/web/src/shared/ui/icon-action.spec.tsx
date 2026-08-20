// @vitest-environment jsdom
/**
 * The icon-only row action, and the two things hand-rolled copies got wrong.
 *
 * Six places wrote this button by hand — delete a role, remove a permission, delete a subscription,
 * revoke an assignment, delete a delegation, and three per row on the people page. None of them had a
 * focus style, so the delete button in five tables was invisible to a keyboard user tabbing to it. And
 * an icon-only button with no accessible name announces itself as "button", which the people page's own
 * local version recorded as the defect it had been extracted to fix.
 *
 * So the assertions are: it has a name, and it has a ring. Not "it renders an icon".
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { Trash2 } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';
import { IconAction } from './tab-scaffold';

describe('IconAction', () => {
  it('announces itself by name rather than as "button"', () => {
    render(<IconAction label="Delete the finance role" icon={Trash2} onClick={vi.fn()} />);

    // Found BY the name — an icon-only button whose only child is an SVG has no other one.
    expect(screen.getByRole('button', { name: 'Delete the finance role' })).toBeInTheDocument();
  });

  it('carries a focus ring, which is the whole reason it is a component', () => {
    /*
     * THE DEFECT, as a test. Every hand-rolled copy had `hover:bg-danger-bg` and no `focus` rule at all,
     * so tabbing to a delete button changed nothing on screen. Asserted on the class rather than by
     * focusing, because jsdom computes no styles — what is checkable here is that the rule is present,
     * and it is present because this is built on `Button`.
     */
    render(<IconAction label="x" icon={Trash2} onClick={vi.fn()} />);
    expect(screen.getByRole('button').className).toContain('focus-visible:ring');
  });

  it('tones a destructive action without losing the ring', () => {
    render(<IconAction label="x" icon={Trash2} tone="danger" onClick={vi.fn()} />);

    const button = screen.getByRole('button');
    expect(button.className).toContain('hover:text-danger');
    // Both, because the danger tone is applied through `className` and a naive implementation would
    // replace the base classes rather than extend them.
    expect(button.className).toContain('focus-visible:ring');
  });

  it('sets BOTH aria-label and title from the one prop', () => {
    /*
     * ASSERTED SEPARATELY, and I found out why the hard way. Removing `aria-label` and keeping only
     * `title` left the "announces itself by name" test above passing — because `title` is itself a
     * last-resort accessible-name source, so testing-library computes the same name from it. That
     * mutant was an equivalent implementation rather than a defect.
     *
     * Both are still wanted: `aria-label` is the explicit contract for assistive technology, and
     * `title` is the hover tooltip a mouse user gets. The call sites used to spell them out twice and
     * could drift; one prop feeds both, and this pins that.
     */
    render(<IconAction label="Revoke assignment" icon={Trash2} onClick={vi.fn()} />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label', 'Revoke assignment');
    expect(button).toHaveAttribute('title', 'Revoke assignment');
  });

  it('fires, and does not while disabled', () => {
    const onClick = vi.fn();
    const { rerender } = render(<IconAction label="x" icon={Trash2} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();

    rerender(<IconAction label="x" icon={Trash2} disabled onClick={onClick} />);
    // The attribute, not a second click: jsdom delivers clicks to disabled elements where a browser does
    // not, so asserting "not called" here would be testing jsdom.
    expect(screen.getByRole('button')).toBeDisabled();
  });
});

describe('Button, for what the shell needed from it', () => {
  it('takes a ref, which is why the bell could not use it before', () => {
    /*
     * The notification bell measures its own trigger for outside-click detection, so it needs the node.
     * React 19 passes `ref` as an ordinary prop, but the TYPE has to declare it or a caller gets "not
     * assignable to IntrinsicAttributes & ButtonProps" — and that type error is the reason the bell
     * stayed a raw `<button>`, and therefore stayed without a focus ring.
     */
    const ref = { current: null as HTMLButtonElement | null };
    render(
      <Button ref={ref} aria-label="Notifications">
        bell
      </Button>,
    );
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('has a sidebar variant that uses the sidebar tokens', () => {
    // `ghost` is `text-fg-muted` / `hover:bg-surface-hover`, which reads as invisible on the sidebar —
    // the sidebar is dark in light mode and has its own token family. That mismatch is why the shell's
    // five controls kept bespoke classes instead of using the kit.
    render(<Button variant="sidebar">Sign out</Button>);

    const button = screen.getByRole('button');
    expect(button.className).toContain('text-sidebar-fg');
    expect(button.className).toContain('focus-visible:ring');
  });

  it('has a row size for full-width menu items', () => {
    render(
      <Button variant="sidebar" size="row">
        Sign out
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button.className).toContain('w-full');
    // Left-aligned: a menu row is a list item, not a centred call to action.
    expect(button.className).toContain('justify-start');
  });
});
