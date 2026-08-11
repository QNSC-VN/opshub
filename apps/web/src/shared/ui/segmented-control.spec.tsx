// @vitest-environment jsdom
/**
 * SegmentedControl — a radio group, which is what six hand-rolled copies were pretending not to be.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './segmented-control';

const OPTIONS = [
  { value: '', label: 'All' },
  { value: 'critical', label: 'Critical' },
  { value: 'low', label: 'Low' },
];

function setup(value = '') {
  const onChange = vi.fn();
  render(
    <SegmentedControl
      label="Filter by severity"
      options={OPTIONS}
      value={value}
      onChange={onChange}
    />,
  );
  return { onChange };
}

describe('SegmentedControl', () => {
  it('is a NAMED radio group — one choice from a set, not a row of toggles', () => {
    // `aria-pressed` toggles would say each option is independently on or off, which is how a
    // multi-select filter behaves and not this.
    setup('critical');
    const group = screen.getByRole('radiogroup', { name: 'Filter by severity' });
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios[1]).toHaveAttribute('aria-checked', 'true');
    expect(radios[0]).toHaveAttribute('aria-checked', 'false');
  });

  it('is a single tab stop', () => {
    setup('low');
    const radios = screen.getAllByRole('radio');
    expect(radios[2]).toHaveAttribute('tabindex', '0');
    expect(radios[0]).toHaveAttribute('tabindex', '-1');
  });

  it('moves with the arrow keys, wrapping, on both axes', () => {
    const { onChange } = setup('');
    const group = screen.getByRole('radiogroup');

    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('critical');

    // Up/Down as well as Left/Right: a horizontal strip still answers the vertical keys, which is
    // what somebody navigating by feel will press.
    fireEvent.keyDown(group, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith('low');
  });

  it('selects on click', () => {
    const { onChange } = setup();
    screen.getByRole('radio', { name: 'Critical' }).click();
    expect(onChange).toHaveBeenCalledWith('critical');
  });
});
