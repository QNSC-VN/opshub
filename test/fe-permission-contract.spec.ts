/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERMISSION, WILDCARD_PERMISSION } from '../db/permissions.catalog';

/**
 * Frontend ↔ backend permission contract.
 *
 * The SPA gates navigation and actions on permission codes it receives from `/me`
 * — `can('asset.read')`, `cap: 'rbac.read'` on a nav item. Those are plain string
 * literals in TSX, so nothing type-checks them against the catalogue: a typo, or a
 * code that was renamed on the backend, silently hides a menu item for everyone.
 * It fails quietly and in the direction nobody reports, because the user simply
 * never sees the feature.
 *
 * This asserts the frontend's literals are a SUBSET of the catalogue. It runs in
 * the backend suite on purpose: the catalogue lives in `db/`, and this way the
 * check cannot be skipped by running only one project's tests.
 *
 * The reverse direction is deliberately NOT asserted — plenty of backend codes have
 * no UI (approval-engine steps, webhook management), and requiring a UI per code
 * would be noise.
 */

const ROOT = join(__dirname, '..');
const VALID = new Set<string>([...Object.values(PERMISSION), WILDCARD_PERMISSION]);

/** `cap: 'x'` on nav/command items, and `can('x')` / `can("x")` call sites. */
const PATTERNS = [/\bcap:\s*'([^']+)'/g, /\bcan\(\s*'([^']+)'\s*\)/g, /\bcan\(\s*"([^"]+)"\s*\)/g];

function webSources(): string[] {
  return execFileSync('git', ['ls-files', 'apps/web/src'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => !f.includes('/generated/'));
}

describe('frontend permission literals', () => {
  it('all exist in the catalogue', () => {
    const offenders: string[] = [];

    for (const file of webSources()) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      for (const pattern of PATTERNS) {
        for (const match of source.matchAll(pattern)) {
          const code = match[1];
          // Only judge things shaped like a permission code. `can()` is also used
          // with other arguments in places, and nav items carry unrelated strings.
          if (!/^[a-z_]+(\.[a-z_*]+)+$/.test(code)) continue;
          if (!VALID.has(code)) offenders.push(`${file}: ${code}`);
        }
      }
    }

    expect(
      offenders,
      `These frontend permission literals are not in db/permissions.catalog.ts, so ` +
        `the gated UI is hidden for every user:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('finds literals at all, so a broken scanner fails loudly', () => {
    // Without this, a regex that stops matching turns the test above into a
    // permanent pass — the classic way a contract test quietly dies.
    let found = 0;
    for (const file of webSources()) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      for (const pattern of PATTERNS) found += [...source.matchAll(pattern)].length;
    }
    expect(found).toBeGreaterThan(5);
  });
});
