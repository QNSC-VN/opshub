import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTION, AUDIT_RESOURCE } from '../libs/modules/audit/src/domain/audit-catalogue';

/**
 * The audit catalogue has ONE definition.
 *
 * `libs/shared-kernel/src/constants.ts` used to carry a second `AUDIT_ACTION` — 40 keys against the
 * real 181 — and nothing caught it because nothing imported it. The danger was that `shared-kernel`
 * is re-exported wholesale, so `import { AUDIT_ACTION } from '@shared-kernel'` resolved to the
 * smaller set, and four of its keys held DIFFERENT VALUES for the same event
 * (`catalog.item_created` vs `catalog_item.created`). Writing one and querying the other loses rows
 * from the trail, and nothing fails.
 *
 * So this asserts the shape rather than the contents: one place declares each catalogue, and every
 * action string is unique.
 */
const ROOT = join(__dirname, '..');
const SOURCE_OF_TRUTH = 'libs/modules/audit/src/domain/audit-catalogue.ts';

function filesDeclaring(symbol: string): string[] {
  return execFileSync('git', ['ls-files', 'libs/**/*.ts', 'db/**/*.ts', 'apps/**/*.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .filter((f) =>
      new RegExp(`^export const ${symbol}\\b`, 'm').test(readFileSync(join(ROOT, f), 'utf8')),
    );
}

describe('audit catalogue single source', () => {
  it.each(['AUDIT_ACTION', 'AUDIT_RESOURCE'])('declares %s in exactly one file', (symbol) => {
    expect(filesDeclaring(symbol)).toEqual([SOURCE_OF_TRUTH]);
  });

  it('gives every action and resource a unique string', () => {
    // A duplicated VALUE under two keys is the other half of the same failure: two names for one
    // event means half the rows are filed under a string nobody queries.
    for (const catalogue of [AUDIT_ACTION, AUDIT_RESOURCE]) {
      const values = Object.values(catalogue);
      expect(new Set(values).size, JSON.stringify(values)).toBe(values.length);
    }
  });
});
