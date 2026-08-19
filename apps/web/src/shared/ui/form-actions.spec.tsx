// @vitest-environment jsdom
/**
 * The footer, and the one prop that made nineteen forms open-code it.
 *
 * `FormActions` said "Saving…" and nothing else, so a contract termination could either use the shared
 * footer and claim it was saving, or keep "Terminating…" and hand-roll the whole thing. All nineteen
 * chose the honest wording. `pendingLabel` is what makes that choice unnecessary.
 *
 * So the assertions here are about the wording and the ORDER, not the styling: cancel-before-submit is
 * the property a hand-rolled copy is free to get wrong, and reversing it puts a destructive button
 * exactly where the previous screen put Cancel.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FormActions } from './tab-scaffold';

describe('FormActions', () => {
  it('says the caller’s verb in flight, not "Saving…"', () => {
    render(
      <FormActions loading onClose={vi.fn()} submitLabel="Terminate" pendingLabel="Terminating…" />,
    );

    /*
     * THE REASON THE COMPONENT WAS BYPASSED. "Terminating…" tells the user which irreversible thing is
     * in progress; "Saving…" on a contract termination is wrong about what is happening, and a spinner
     * says only that something is.
     */
    expect(screen.getByRole('button', { name: 'Terminating…' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Terminate' })).toBeNull();
  });

  it('falls back to "Saving…" so the common case needs no prop', () => {
    render(<FormActions loading onClose={vi.fn()} submitLabel="Save draft" />);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeInTheDocument();
  });

  it('shows the submit label and enables it when idle', () => {
    render(
      <FormActions
        loading={false}
        onClose={vi.fn()}
        submitLabel="Assign"
        pendingLabel="Assigning…"
      />,
    );
    const submit = screen.getByRole('button', { name: 'Assign' });
    expect(submit).toBeEnabled();
    expect(submit).toHaveAttribute('type', 'submit');
  });

  it('puts Cancel before submit, every time', () => {
    render(<FormActions loading={false} onClose={vi.fn()} submitLabel="Offboard employee" />);

    // DOM order, which is also tab order. A footer that reverses it puts the destructive action under
    // the pointer that was over Cancel on the previous screen.
    const [first, second] = screen.getAllByRole('button');
    expect(first).toHaveTextContent('Cancel');
    expect(second).toHaveTextContent('Offboard employee');
  });

  it('keeps Cancel usable while the submit is in flight', () => {
    render(<FormActions loading onClose={vi.fn()} submitLabel="Activate" />);
    // Only the submit is disabled. Locking Cancel during a request traps the user in a modal for as
    // long as the network takes.
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('type', 'button');
  });

  it('takes a node for the submit label, because create-vs-edit switches the wording', () => {
    const editing = true;
    render(
      <FormActions
        loading={false}
        onClose={vi.fn()}
        submitLabel={editing ? 'Save course' : 'Create course'}
      />,
    );
    expect(screen.getByRole('button', { name: 'Save course' })).toBeInTheDocument();
  });
});
