/**
 * The type scale has a bottom step, and it is smaller than the one above it.
 *
 * WHY THIS EXISTS. Twenty-six places used `text-[10px]` because Tailwind's smallest step is `text-xs` at
 * 12px and the product needed 10 — badge counts, `kbd` hints, uppercase group labels. They are all
 * `text-2xs` now, which only means anything while `--text-2xs` is defined in `@theme`.
 *
 * THE FAILURE MODE IS SILENT. Delete that one line and Tailwind generates no `.text-2xs` rule at all;
 * the class stays in the markup, matches nothing, and every one of those elements falls back to the
 * inherited size. Nothing throws, no test that renders a component notices, and the first report is
 * somebody saying the badges look wrong. So the token is asserted where it is declared.
 *
 * A CSS FILE, READ AS TEXT, deliberately: the alternative is a browser-rendered check, and jsdom
 * computes no styles. What is verifiable here is that the declaration exists and what it says.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = join(import.meta.dirname, '../../app/styles/globals.css');

/** The value of a `--text-*` step, in rem. */
function step(name: string): number | null {
  const source = readFileSync(CSS, 'utf8');
  const match = new RegExp(`--text-${name}:\\s*([0-9.]+)rem`).exec(source);
  return match ? Number(match[1]) : null;
}

describe('the type scale', () => {
  it('defines the 2xs step every badge in the product now uses', () => {
    expect(
      step('2xs'),
      'the `text-2xs` step is gone — twenty-six elements are now unstyled and nothing else will say so',
    ).not.toBeNull();
  });

  it('sets it to 10px, which is the size those call sites needed', () => {
    // 0.625rem at a 16px root. Asserted as a number rather than a string so `0.625rem` and `.625rem`
    // both pass — the value is the contract, not its spelling.
    expect(step('2xs')).toBe(0.625);
  });

  it('keeps it smaller than the step above, or it is not a step', () => {
    /*
     * The mutation this catches is `--text-2xs: 0.75rem` — same as `text-xs`. Every class still resolves,
     * every test still passes, and the twenty-six elements silently grow by a fifth, which is exactly the
     * change this whole conversion existed to avoid.
     *
     * `text-xs` is Tailwind's own default (0.75rem) and is not redeclared here, so it is the literal to
     * compare against; if the project ever overrides it, this reads the override.
     */
    const xs = step('xs') ?? 0.75;
    expect(step('2xs')!).toBeLessThan(xs);
  });

  it('gives it a line height, so a 10px label is not laid out for 16px text', () => {
    // Tailwind pairs a `--text-*--line-height` with each step. Without it the step inherits the previous
    // line box and the badges sit unevenly — visible, but not in a way a class-name check would find.
    const source = readFileSync(CSS, 'utf8');
    expect(source).toMatch(/--text-2xs--line-height:\s*[0-9.]+rem/);
  });
});
