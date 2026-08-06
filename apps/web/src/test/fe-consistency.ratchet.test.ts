/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Frontend-consistency ratchets — guardrails for the component-system migration.
 *
 * Each baseline is frozen at the CURRENT count and may only ever DECREASE as pages adopt the
 * shared primitives. A rising count means new code re-hand-rolled something the design
 * system already owns: fix the code, not the baseline.
 *
 * Ported from rally, and its docblock carries the lesson that shaped this file. Four of
 * rally's six baselines had drifted well ABOVE the real count, so 39 new violations could
 * have landed green — "a ratchet with slack in it is not a ratchet; it is a comment". Every
 * number below was therefore measured by forcing it to -1 and reading the count the failure
 * reports, never by grepping alongside, because an approximate grep sets the bar in the
 * wrong place.
 *
 * TWO OF RALLY'S SIX CHECKS ARE DELIBERATELY ABSENT, because opshub has nowhere for those
 * violations to go and a ratchet pointing at a destination that does not exist is worse than
 * none — it implies a migration nobody can perform:
 *
 *  - raw Tailwind font sizes (`text-sm`, `text-lg`, …). rally routes type through a
 *    `text-ui-*` scale in its `@theme`. opshub's globals.css defines no such scale, and
 *    there are 692 occurrences — freezing that would pin a number with no migration path.
 *    Add the scale first, then add the check.
 *  - hardcoded JSX copy. rally's proxy for un-internationalised text assumes a `t()` to wire
 *    it through. opshub has no i18n layer at all.
 */

// ── Baselines — LOWER as the migration proceeds, NEVER raise ───────────────────
//
// `<button>` has a destination: shared/ui/button.tsx. 149 is a lot, and that is the point of
// recording it — the number cannot grow while it is being worked down.
const MAX_RAW_BUTTON = 149;
// Inline style is nearly clean already. Static colour and spacing belong in token utilities;
// the residue is data-driven (a computed width, a chart dimension).
const MAX_INLINE_STYLE = 4;
// Arbitrary `text-[13px]`-style values. Destination is a plain Tailwind size — this one does
// not need a custom scale, unlike the font-size check omitted above.
const MAX_ARBITRARY_TEXT = 29;
// Largest single source file, counted as `split('\n').length` — ONE MORE than `wc -l`, which
// is worth stating because setting this from `wc -l` output puts it one below the real count
// and the ratchet fails on the file it was measured from. rally's docblock flags the same trap.
// pages/people/people-page.tsx. Pages are composition; a file this size is doing more than
// composing. The generated API client is excluded — it is 7575 lines and not hand-written.
const MAX_FILE_LINES = 1082;

// this file lives in src/test/
const SRC = join(import.meta.dirname, '../');

function files(predicate: (rel: string) => boolean): string[] {
  return (
    readdirSync(SRC, { recursive: true, encoding: 'utf8' })
      .map((f) => f.split(/[\\/]/).join('/'))
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => !/\.(test|spec)\.tsx?$/.test(f))
      .filter((f) => !/\.d\.ts$/.test(f))
      // Generated from the OpenAPI spec: not hand-written, and regenerating it must never
      // trip a style gate.
      .filter((f) => !f.startsWith('shared/api/generated'))
      .filter(predicate)
  );
}

const inConsumerLayers = (rel: string) =>
  /^(pages|features|entities|widgets)\//.test(rel) && rel.endsWith('.tsx');

function countMatches(predicate: (rel: string) => boolean, re: RegExp) {
  const byFile: Record<string, number> = {};
  let total = 0;
  for (const rel of files(predicate)) {
    const n = (readFileSync(join(SRC, rel), 'utf8').match(re) ?? []).length;
    if (n) {
      byFile[rel] = n;
      total += n;
    }
  }
  return { total, byFile };
}

function worst(byFile: Record<string, number>, k = 10): string {
  return Object.entries(byFile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([f, n]) => `  ${n.toString().padStart(4)}  ${f}`)
    .join('\n');
}

function assertRatchet(label: string, total: number, max: number, byFile: Record<string, number>) {
  if (total > max) {
    throw new Error(
      `${label} rose to ${total} (baseline ${max}). Use the shared primitive instead of ` +
        `raising the baseline. Worst files:\n${worst(byFile)}`,
    );
  }
  expect(total).toBeLessThanOrEqual(max);
}

describe('FE consistency ratchets (only ever decrease)', () => {
  it('finds the source surface it claims to guard', () => {
    // A scanner that stops seeing files reports zero violations, which is indistinguishable
    // from a finished migration.
    expect(
      files(inConsumerLayers).length,
      'Found almost no consumer-layer files. The scanner is broken, not the pages.',
    ).toBeGreaterThanOrEqual(10);
  });

  it(`raw <button> in consumer layers <= ${MAX_RAW_BUTTON}`, () => {
    const { total, byFile } = countMatches(inConsumerLayers, /<button/g);
    assertRatchet('raw <button> count', total, MAX_RAW_BUTTON, byFile);
  });

  it(`inline style={{}} in consumer layers <= ${MAX_INLINE_STYLE}`, () => {
    const { total, byFile } = countMatches(inConsumerLayers, /style=\{\{/g);
    assertRatchet('inline style={{ count', total, MAX_INLINE_STYLE, byFile);
  });

  it(`arbitrary text-[…] app-wide <= ${MAX_ARBITRARY_TEXT}`, () => {
    const { total, byFile } = countMatches((f) => f.endsWith('.tsx'), /text-\[/g);
    assertRatchet('arbitrary text-[ count', total, MAX_ARBITRARY_TEXT, byFile);
  });

  it(`largest source file <= ${MAX_FILE_LINES} lines`, () => {
    const byFile: Record<string, number> = {};
    for (const rel of files(() => true)) {
      byFile[rel] = readFileSync(join(SRC, rel), 'utf8').split('\n').length;
    }
    const [file, lines] = Object.entries(byFile).sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    if (lines > MAX_FILE_LINES) {
      throw new Error(
        `${file} is ${lines} lines (ceiling ${MAX_FILE_LINES}). Decompose it rather than ` +
          `raising the ceiling — pages are composition, one component per file.`,
      );
    }
    expect(lines).toBeLessThanOrEqual(MAX_FILE_LINES);
  });
});
