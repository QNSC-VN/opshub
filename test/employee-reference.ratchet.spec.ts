/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A reference to an employee is validated by `assertExist`, and by nothing else.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. `owner_id`, `custodian_id`, `assigned_to`, `reviewer_id`,
 * `lead_auditor_id`, `chair_id` — every one of them points across a schema boundary at
 * `identity.employees`, and by deliberate design NONE of them carries a foreign key (migration 0022
 * writes that down: "cross-schema references here carry no FK"). So the database will not catch a
 * typo'd uuid. The only thing between a bad reference and a risk owned by nobody is a check in the
 * application, and a check that is easy to forget will be forgotten.
 *
 * WHAT THE OLD SHAPE WAS. Thirty-four call sites wrote this:
 *
 *     await this.employees.getById(dto.ownerId);
 *     if (dto.custodianId) await this.employees.getById(dto.custodianId);
 *
 * An awaited call with no left-hand side, whose entire purpose is to throw. It reads like a mistake —
 * a fetch whose result someone forgot to use — so the next person to touch the handler has no reason
 * to keep it, and `git blame` on a deleted line tells nobody it was load-bearing. Twelve of them wore
 * an `if` because the column was nullable, so the guard's shape varied with the schema.
 *
 * BASELINE ZERO, on the shape rather than on a count of validated columns. `assertExist` covers every
 * case: one id or several, nullish skipped, one query, and the failure names which reference was
 * wrong. There is nothing left that `getById`-as-a-guard can do that this cannot, so a match here is
 * a call site that has drifted back rather than a case the helper does not serve.
 *
 * __dirname, not import.meta.dirname: this suite runs as CommonJS.
 */

const ROOT = join(__dirname, '..');

/** The service that owns the check, and so is the one file allowed to describe the old shape. */
const OWNER = 'libs/modules/identity/src/application/employee.service.ts';

/**
 * An awaited `getById` used as a statement — value discarded, optionally behind a one-line `if`.
 *
 * Anchored to the start of a line and requiring the semicolon, so `const employee = await
 * x.getById(id)` and `(await x.getById(id)).displayName` are NOT matched. Reading a person is a
 * legitimate thing to do; reading one in order to ignore them is the shape being retired.
 */
const DISCARDED_GET =
  /^\s*(?:if \([\w.]+\) )?await this\.[\w.]*[eE]mployee[\w.]*\.getById\([^)]*\);\s*$/;

interface Offender {
  file: string;
  line: number;
  text: string;
}

function sourceFiles(): string[] {
  return (
    execFileSync(
      'git',
      // `--others --exclude-standard` as well as the index: a new controller is the likeliest place for
      // a fresh violation, and a bare `git ls-files` cannot see one until it is staged.
      ['ls-files', '--cached', '--others', '--exclude-standard', 'libs', 'apps'],
      { cwd: ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => !/\.(spec|e2e)\.ts$/.test(f))
      .filter((f) => !f.includes('/generated/'))
      // The index lists a file deleted but not yet staged; reading it throws and takes the ratchet down.
      .filter((f) => existsSync(join(ROOT, f)))
  );
}

function scan(): Offender[] {
  const offenders: Offender[] = [];
  for (const file of sourceFiles()) {
    if (file === OWNER) continue;
    readFileSync(join(ROOT, file), 'utf8')
      .split('\n')
      .forEach((line, index) => {
        // A line of prose about the old shape is not the old shape. Comments are excluded by the
        // anchor requiring the statement to start the line, but `*` continuation lines can carry a
        // full statement inside a docblock, so drop those explicitly.
        if (/^\s*(\*|\/\/)/.test(line)) return;
        if (DISCARDED_GET.test(line)) {
          offenders.push({ file, line: index + 1, text: line.trim().slice(0, 120) });
        }
      });
  }
  return offenders;
}

describe('employee reference validation', () => {
  it('finds the guard it claims to guard', () => {
    /*
     * The floor. A ratchet on an ABSENT shape passes trivially when the thing it protects is gone: if
     * `assertExist` were deleted, every call site would break at compile time, but this file would go
     * green. So the floor is the helper's existence AND that the call sites still use it — measured
     * through the same file list the scan uses, so a broken scanner cannot report a clean sweep of
     * nothing.
     */
    const files = sourceFiles();
    expect(files.length, 'the scanner sees almost no source files').toBeGreaterThan(100);

    const owner = readFileSync(join(ROOT, OWNER), 'utf8');
    expect(
      owner,
      'assertExist is gone — nothing validates a cross-schema employee reference',
    ).toContain('async assertExist(');

    const callers = files.filter(
      (f) => f !== OWNER && /\.assertExist\(/.test(readFileSync(join(ROOT, f), 'utf8')),
    );
    expect(
      callers.length,
      'nothing calls assertExist — the check below proves nothing',
    ).toBeGreaterThanOrEqual(15);
  });

  it('has no employee lookup used only for its throw', () => {
    const offenders = scan();

    if (offenders.length > 0) {
      const report = offenders.map((o) => `  ${o.file}:${o.line}\n      ${o.text}`).join('\n');
      throw new Error(
        `${offenders.length} employee lookup(s) whose result is discarded.\n` +
          `A fetch with no left-hand side reads like a mistake, so the next person deletes it — and ` +
          `these columns carry no foreign key, so deleting it is how a risk ends up owned by nobody. ` +
          `Use \`assertExist(...ids)\`: it takes every reference at once, skips nullish ones, and ` +
          `names the ids that were missing.\n\n${report}`,
      );
    }

    expect(offenders.length).toBe(0);
  });
});
