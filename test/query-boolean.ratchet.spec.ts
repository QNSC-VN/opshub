/**
 * Boolean query parameters must be PARSED, not coerced. A floor, not a count.
 *
 * `z.coerce.boolean()` is `Boolean(value)`, and every non-empty string is truthy — so a caller sending
 * `?includeRetired=false` got the retired rows anyway. Measured on the running API:
 *
 *   GET /v1/training/courses                        → total 2   (retired hidden, correct)
 *   GET /v1/training/courses?includeRetired=false   → total 3   (retired SHOWN, wrong)
 *
 * Twenty filters across training, ISMS, QMS, documents, licences and positions had it. The reason none
 * of the API's own tests caught it is worth stating: a test that wants a filter off OMITS the parameter,
 * and omitting works. It only breaks for a client that sends its state on every request — which is
 * exactly what a UI toggle does, and why this was found the day a toggle was built.
 *
 * `queryBoolean()` (libs/platform/src/http/query-boolean.ts) reads the spellings a query string carries
 * and REFUSES what it cannot read. Zero occurrences of the coercing version, everywhere, forever.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

function sourceFiles(): string[] {
  return (
    execFileSync('git', ['ls-files', '*.ts'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .filter((file) => !file.includes('node_modules'))
      // The docblock above and this scanner both NAME the pattern they forbid; a check that counted its
      // own explanation as a violation would make writing one cost a point.
      .filter((file) => !file.endsWith('query-boolean.ts'))
      .filter((file) => !file.endsWith('query-boolean.spec.ts'))
      .filter((file) => !file.endsWith('query-boolean.ratchet.spec.ts'))
      .filter((file) => existsSync(join(ROOT, file)))
  );
}

describe('boolean query parameters are parsed, not coerced', () => {
  it('finds the source surface it claims to guard', () => {
    expect(
      sourceFiles().length,
      'Found almost no TypeScript files. The scanner is broken, not the DTOs.',
    ).toBeGreaterThanOrEqual(50);
  });

  it('has no z.coerce.boolean() anywhere', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      const hits = source.split('\n').filter((line) => line.includes('z.coerce.boolean'));
      for (const line of hits) offenders.push(`${file}: ${line.trim()}`);
    }

    if (offenders.length > 0) {
      throw new Error(
        `z.coerce.boolean() treats '?flag=false' as TRUE. Use queryBoolean() from @platform.\n` +
          offenders.map((o) => `  ${o}`).join('\n'),
      );
    }
    expect(offenders).toHaveLength(0);
  });
});
