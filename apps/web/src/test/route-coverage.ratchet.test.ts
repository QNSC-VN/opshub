/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The route sweep must cover every route the router serves.
 *
 * WHY THIS GUARD EXISTS. `e2e/no-failed-requests.e2e.ts` visits a hand-written list and asserts no screen
 * renders while its own requests are failing. That check is only as good as the list: add a route to the
 * router, forget the list, and the new screen is the one place the sweep does not look — which is the same
 * shape as the bug the sweep was written for, one level up. Six report panels were failing for exactly as
 * long as nothing asked.
 *
 * SOURCE TEXT, NOT AN IMPORT. The route list lives under `e2e/`, which is outside the app's tsconfig and
 * built by Playwright rather than Vite. Reading both files as text is what `fe-consistency.ratchet.test.ts`
 * does for the same reason, and it costs nothing here: both are literal `path: '/…'` declarations.
 *
 * `/login` is the one deliberate exclusion — it renders outside the shell, so `gotoInShell` cannot assert it.
 */

const WEB = join(import.meta.dirname, '../../');
const OUTSIDE_THE_SHELL = ['/login'];

function routerPaths(): string[] {
  const source = readFileSync(join(WEB, 'src/app/router/router.tsx'), 'utf8');
  const found = [...source.matchAll(/path: '(\/[a-z0-9/_-]*)'/g)].map((m) => m[1]);
  return [...new Set(found)].filter((p) => !OUTSIDE_THE_SHELL.includes(p)).sort();
}

function sweptPaths(): string[] {
  const source = readFileSync(join(WEB, 'e2e/support/routes.ts'), 'utf8');
  const body = source.slice(source.indexOf('SHELL_ROUTES'));
  return [...body.matchAll(/'(\/[a-z0-9/_-]*)'/g)].map((m) => m[1]).sort();
}

describe('route coverage', () => {
  it('finds the surface it claims to guard', () => {
    // A regex that stops matching reports perfect coverage of nothing, which is indistinguishable from
    // perfect coverage of everything — the same trap the FE ratchets guard with their own floor.
    expect(
      routerPaths().length,
      'parsed almost no routes — the router moved or its shape changed',
    ).toBeGreaterThanOrEqual(20);
  });

  it('sweeps every route the router serves', () => {
    const router = routerPaths();
    const swept = sweptPaths();

    const missing = router.filter((p) => !swept.includes(p));
    const stale = swept.filter((p) => !router.includes(p));

    expect(
      missing,
      `these routes exist but are not swept by e2e/no-failed-requests.e2e.ts — add them to ` +
        `e2e/support/routes.ts:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
    expect(stale, `these are swept but no longer exist:\n  ${stale.join('\n  ')}`).toEqual([]);
  });
});
