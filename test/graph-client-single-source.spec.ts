/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * One place builds a Microsoft Graph client.
 *
 * WHAT WAS WRONG. Five services — PIM elevation, Entra provisioning, Intune device sync, shadow-IT
 * detection and Secure Score — each carried a private `buildClient()` reading the same three env vars,
 * constructing the same credential with the same `.default` scope, plus a public `isEnabled()` written
 * three different ways (`Boolean(a && b && c)`, `!!(a && b && c)`, and a three-`const` version).
 *
 * The duplication was not the expensive part. `buildClient()` was called PER OPERATION and
 * `ClientSecretCredential` caches its access token in the instance, so every Graph call paid a fresh
 * client-credentials round trip to Entra for a token it already had. Entra throttles that endpoint;
 * the symptom of reaching the limit is a failed offboarding, not a slow one.
 *
 * WHY A RATCHET. The next Graph integration is written by copying the nearest one, which is how five
 * copies happened. `GraphClientService` is injectable and global, so there is nothing left for a sixth
 * copy to do that it cannot — and this fails the moment one appears.
 *
 * __dirname, not import.meta.dirname: this suite runs as CommonJS.
 */

const ROOT = join(__dirname, '..');

/** The one file allowed to construct a credential and a client. */
const OWNER = 'libs/platform/src/graph/graph-client.service.ts';

/** Constructing the client, or the credential it wraps, or naming the scope. */
const BUILDS_CLIENT =
  /Client\.initWithMiddleware|new ClientSecretCredential|graph\.microsoft\.com\/\.default/;

/** The env vars that make up the answer, read directly rather than asked for. */
const READS_GRAPH_CONFIG = /config\.get\('GRAPH_CLIENT_SECRET'\)/;

interface Offender {
  file: string;
  line: number;
  text: string;
}

function sourceFiles(): string[] {
  return (
    execFileSync(
      'git',
      // `--others --exclude-standard` too: a NEW integration service is the likeliest sixth copy, and a
      // bare `git ls-files` cannot see one until it is staged.
      ['ls-files', '--cached', '--others', '--exclude-standard', 'libs', 'apps'],
      { cwd: ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => !/\.(spec|e2e)\.ts$/.test(f))
      .filter((f) => !f.includes('/generated/'))
      // The index lists a file deleted but not yet staged; reading it would throw and take this down.
      .filter((f) => existsSync(join(ROOT, f)))
  );
}

function scan(pattern: RegExp): Offender[] {
  const offenders: Offender[] = [];
  for (const file of sourceFiles()) {
    if (file === OWNER) continue;
    readFileSync(join(ROOT, file), 'utf8')
      .split('\n')
      .forEach((line, index) => {
        // Prose about the rule is not a violation of it — this file's own docblock would count itself.
        if (/^\s*(\*|\/\/)/.test(line)) return;
        if (pattern.test(line)) {
          offenders.push({ file, line: index + 1, text: line.trim().slice(0, 120) });
        }
      });
  }
  return offenders;
}

describe('Graph client single source', () => {
  it('finds the factory it claims to guard', () => {
    /*
     * The floor. A check on an ABSENT pattern passes trivially when the thing it protects is gone: if
     * the factory were deleted, every consumer would fail to compile, but this file would go green. So
     * the floor is the factory's existence, that it still builds a client, that it still caches one,
     * and that the five consumers still ask it — measured through the same file list the scan uses.
     */
    const files = sourceFiles();
    expect(files.length, 'the scanner sees almost no source files').toBeGreaterThan(100);
    expect(files, 'the Graph factory is gone').toContain(OWNER);

    const owner = readFileSync(join(ROOT, OWNER), 'utf8');
    expect(owner).toMatch(BUILDS_CLIENT);
    expect(owner, 'the factory no longer caches the client').toMatch(/this\.cached/);

    const consumers = files.filter(
      (f) => f !== OWNER && /GraphClientService/.test(readFileSync(join(ROOT, f), 'utf8')),
    );
    expect(
      consumers.length,
      'nothing injects the Graph factory — the checks below prove nothing',
    ).toBeGreaterThanOrEqual(5);
  });

  it('has no second place building a Graph client', () => {
    const offenders = scan(BUILDS_CLIENT);

    if (offenders.length > 0) {
      const report = offenders.map((o) => `  ${o.file}:${o.line}\n      ${o.text}`).join('\n');
      throw new Error(
        `${offenders.length} place(s) building a Graph client outside ${OWNER}.\n` +
          `A client built per call throws away the credential's token cache, so every Graph ` +
          `operation costs a client-credentials round trip to Entra — which is throttled. Inject ` +
          `\`GraphClientService\` and call \`client()\`.\n\n${report}`,
      );
    }

    expect(offenders.length).toBe(0);
  });

  it('has no second answer to whether Graph is configured', () => {
    // `isEnabled()` gates every Graph path, so two implementations of it can disagree about whether
    // the integration is on — and the failure mode is a silent skip, which reports success.
    const offenders = scan(READS_GRAPH_CONFIG);

    if (offenders.length > 0) {
      const report = offenders.map((o) => `  ${o.file}:${o.line}\n      ${o.text}`).join('\n');
      throw new Error(
        `${offenders.length} place(s) reading GRAPH_CLIENT_SECRET outside ${OWNER}.\n` +
          `Ask \`GraphClientService.isEnabled()\` instead — five copies of this boolean, in three ` +
          `spellings, is what this replaced.\n\n${report}`,
      );
    }

    expect(offenders.length).toBe(0);
  });
});
