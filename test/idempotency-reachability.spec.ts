/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_REPLAYED_HEADER,
} from '../libs/platform/src/http/idempotency.interceptor';

/**
 * The idempotency feature is reachable from a browser.
 *
 * WHAT WAS WRONG, and why a unit test could not have found it. `IdempotencyInterceptor` was correct,
 * registered globally, and unreachable: `Idempotency-Key` was absent from the CORS `allowedHeaders`, so
 * a browser's preflight refused the request before it was sent, and `X-Idempotent-Replayed` was absent
 * from `exposedHeaders`, so a browser could not have read the answer if it had arrived. Every test that
 * could exist ON the interceptor passed. The defect was in a different file, in a list.
 *
 * So this checks the two halves that make the interceptor observable, against the header names the
 * interceptor itself exports — not against string literals, which would let a rename pass here and
 * break in production.
 *
 * WHY NOT AN END-TO-END TEST. A preflight is a browser behaviour; `app.inject` and `supertest` send the
 * request whether or not CORS would have allowed it, so an e2e would be green against exactly the
 * broken configuration this file exists to catch. The configuration IS the contract.
 *
 * __dirname, not import.meta.dirname: this suite runs as CommonJS.
 */

const ROOT = join(__dirname, '..');
const BOOTSTRAP = 'apps/api/src/bootstrap/app.bootstrap.ts';

function bootstrapSource(): string {
  const path = join(ROOT, BOOTSTRAP);
  expect(existsSync(path), `${BOOTSTRAP} has moved — this check is looking at nothing`).toBe(true);
  return readFileSync(path, 'utf8');
}

/**
 * The two CORS lists, comments stripped.
 *
 * BLOCK-SCOPED ON PURPOSE, and my first version was not. A file-wide search for the header name passed
 * even with the header deleted from the allowlist, because the API description below also names it in
 * prose — so the mutation that reproduced the original defect went undetected by the check written for
 * it. Configuring a header and talking about one are different things and must be measured differently.
 */
function corsLists(): { allowed: string; exposed: string } {
  const source = bootstrapSource();
  const allowed = /allowedHeaders:\s*\[([\s\S]*?)\]/.exec(source);
  const exposed = /exposedHeaders:\s*\[([\s\S]*?)\]/.exec(source);
  expect(allowed, 'no allowedHeaders list found — the CORS config has moved').not.toBeNull();
  expect(exposed, 'no exposedHeaders list found — the CORS config has moved').not.toBeNull();

  const strip = (block: string) => block.replace(/\/\/[^\n]*/g, '').toLowerCase();
  return { allowed: strip(allowed![1]), exposed: strip(exposed![1]) };
}

describe('idempotency reachability', () => {
  it('allows the request header through the preflight', () => {
    expect(
      corsLists().allowed,
      'Idempotency-Key is not in the CORS allowedHeaders, so a browser cannot send it',
    ).toContain(IDEMPOTENCY_KEY_HEADER);
  });

  it('exposes the replay header so a client can tell a replay from an execution', () => {
    expect(
      corsLists().exposed,
      'X-Idempotent-Replayed is not in the CORS exposedHeaders, so a browser cannot read it',
    ).toContain(IDEMPOTENCY_REPLAYED_HEADER);
  });

  it('finds the two CORS lists it claims to be reading', () => {
    /*
     * The floor. Every check here is a substring search over one file, so if the CORS block were
     * deleted or renamed the searches would have nothing to disagree with. `x-csrf-token` is the
     * canary: it is unrelated to idempotency and must be in the same list, so a matcher that has
     * stopped finding the real list fails here rather than reporting a clean sweep of nothing.
     */
    const { allowed, exposed } = corsLists();
    expect(allowed).toContain('x-csrf-token');
    expect(allowed).toContain('authorization');
    expect(exposed).toContain('x-correlation-id');
  });

  it('documents the behaviour where a consumer reads about it', () => {
    // The interceptor is global, so it is described in the API description rather than added as an
    // optional header to two hundred operations. Undocumented, it is a guarantee nobody knows to use.
    const source = bootstrapSource();
    expect(source).toContain('Idempotent retries');
    expect(source).toContain('IDEMPOTENCY_KEY_REUSED');
    expect(source).toContain('IDEMPOTENCY_IN_FLIGHT');
  });
});
