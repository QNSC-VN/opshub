/**
 * An error's CODE and its HTTP STATUS must not contradict each other.
 *
 * WHAT WAS WRONG. `EntityAttachmentsService.remove` threw
 * `PreconditionFailedException(ErrorCodes.FORBIDDEN, 'Only the uploader may remove this file')` — a
 * 412 carrying a `FORBIDDEN` code. The two halves tell a client opposite things: 412 means a condition
 * on the request failed, so change something and retry; `FORBIDDEN` means no retry will help. A client
 * mapping 403 to "you are not allowed to do that" showed a generic failure instead, and the test on
 * that path asserted the CODE only, so it passed either way.
 *
 * The mirror of it sat in the request engine: self-approval threw a plain `PermissionDeniedException`
 * whose code is `FORBIDDEN`, with the real reason smuggled into the message as
 * `'REQUEST_SOD_VIOLATION: …'`. Right status, wrong code — and `ErrorCodes.REQUEST_SOD_VIOLATION` sat
 * in the catalogue never emitted.
 *
 * WHY A TEST OVER THE CATALOGUE rather than a ratchet over call sites. The pairing is decidable from
 * the code catalogue and the exception classes alone: a code whose NAME says "forbidden" or "violation
 * of a rule about who may act" belongs to a 403 class, and any exception class carrying such a code
 * with another status is the contradiction. That is a property of the code, so it is checked where the
 * codes are declared.
 *
 * __dirname, not import.meta.dirname: this suite runs as CommonJS.
 */
/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConflictException,
  ErrorCodes,
  NotFoundException,
  PermissionDeniedException,
  PreconditionFailedException,
  ValidationException,
} from '../libs/platform/src/index';

const ROOT = join(__dirname, '..');

/** The status each exception class produces, as the wire sees it. */
const CLASS_STATUS = [
  { name: 'NotFoundException', status: 404, make: () => new NotFoundException('FORBIDDEN', 'x') },
  { name: 'ConflictException', status: 409, make: () => new ConflictException('FORBIDDEN', 'x') },
  {
    name: 'ValidationException',
    status: 422,
    make: () => new ValidationException('FORBIDDEN', 'x'),
  },
  {
    name: 'PreconditionFailedException',
    status: 412,
    make: () => new PreconditionFailedException('FORBIDDEN', 'x'),
  },
  {
    name: 'PermissionDeniedException',
    status: 403,
    make: () => new PermissionDeniedException('x'),
  },
];

describe('error code and status coherence', () => {
  it('maps each exception class to the status it claims', () => {
    // The floor for everything below: if the base stopped deriving a status from the category, every
    // assertion here would compare undefined with undefined and pass.
    for (const { name, status, make } of CLASS_STATUS) {
      expect(make().httpStatus, `${name} no longer produces ${status}`).toBe(status);
    }
  });

  it('reports an authorization refusal as 403, whatever the reason', () => {
    /*
     * BOTH codes on the SAME class, and both must be 403. This is the pair the product actually
     * refuses on: `FORBIDDEN` for a missing permission and `REQUEST_SOD_VIOLATION` for "you may not
     * decide your own request". They are different remediations — ask for access, or ask a
     * colleague — which is why the code has to carry the difference, and the same status, because both
     * are "no" rather than "not yet".
     */
    expect(new PermissionDeniedException('x').code).toBe(ErrorCodes.FORBIDDEN);
    expect(new PermissionDeniedException('x').httpStatus).toBe(403);

    const sod = new PermissionDeniedException('x', ErrorCodes.REQUEST_SOD_VIOLATION);
    expect(sod.code).toBe(ErrorCodes.REQUEST_SOD_VIOLATION);
    expect(sod.httpStatus).toBe(403);
  });

  it('has no production call site pairing an authorization code with another status', () => {
    /*
     * THE ACTUAL GUARD, and it has to be a source scan.
     *
     * The classes take any code, so the wrong pairing is constructible — asserting on a constructed
     * instance would only prove I passed the code I passed. What must be true is that no CALL SITE
     * does it. `PreconditionFailedException(ErrorCodes.FORBIDDEN, …)` was the one that existed, in a
     * file whose own test asserted the code and not the status, so nothing caught it.
     */
    const files = execFileSync(
      'git',
      // `--others --exclude-standard` too: a new service is the likeliest place for a fresh pairing.
      ['ls-files', '--cached', '--others', '--exclude-standard', 'libs', 'apps'],
      { cwd: ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => !/\.(spec|e2e)\.ts$/.test(f))
      .filter((f) => !f.includes('/generated/'))
      .filter((f) => existsSync(join(ROOT, f)));

    // The scanner must see the codebase, or "no offenders" means "no files".
    expect(files.length, 'the scanner sees almost no source files').toBeGreaterThan(100);

    /*
     * WHITESPACE-TOLERANT, AND SCANNED OVER THE WHOLE FILE rather than line by line. My first version
     * anchored the code to the same line as the constructor, and prettier writes the three-argument
     * form across four lines — so re-introducing the exact defect this test exists for slipped past it.
     * A scanner that only sees the formatting it was written against is not a guard.
     */
    const NON_403 =
      /\b(?:NotFound|Conflict|Validation|PreconditionFailed)Exception\(\s*(?:ErrorCodes\.)?['"]?(FORBIDDEN|REQUEST_SOD_VIOLATION)\b/g;

    const offenders: string[] = [];
    for (const file of files) {
      // Comments stripped first: the fixed call site documents what it used to throw, and prose about
      // a rule is not a violation of it.
      const source = readFileSync(join(ROOT, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/[^\n]*/g, '$1');

      for (const match of source.matchAll(NON_403)) {
        const line = source.slice(0, match.index).split('\n').length;
        offenders.push(`  ${file}:${line}  ${match[1]} on a non-403 exception class`);
      }
    }

    if (offenders.length > 0) {
      throw new Error(
        `${offenders.length} authorization refusal(s) thrown with a non-403 status.\n` +
          `The response contradicts itself: the status invites a retry, the code says no retry can ` +
          `help. Throw \`PermissionDeniedException(message, code)\`.\n\n${offenders.join('\n')}`,
      );
    }
    expect(offenders.length).toBe(0);
  });

  it('emits REQUEST_SOD_VIOLATION somewhere, so the catalogue entry is not decorative', () => {
    /*
     * The floor for the pairing above. `REQUEST_SOD_VIOLATION` sat in the catalogue unemitted while the
     * reason travelled as a prefix on a message — a code nobody throws is a code no client handles, and
     * the check above would be just as green if the fix were reverted to a bare `FORBIDDEN`.
     */
    const engine = readFileSync(
      join(ROOT, 'libs/platform/src/requests/request-engine.service.ts'),
      'utf8',
    );
    expect(engine, 'the SoD refusal no longer carries its own code').toContain(
      'ErrorCodes.REQUEST_SOD_VIOLATION',
    );
    // And not as a prefix on the message, which is where it used to live.
    expect(engine).not.toContain("'REQUEST_SOD_VIOLATION:");
  });
});
