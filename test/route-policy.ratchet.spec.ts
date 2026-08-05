import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Ratchet: how many HTTP route handlers carry NEITHER `@RequirePermission` nor `@Public`.
 *
 * This matters because of one line in `libs/platform/src/auth/policy.guard.ts`:
 *
 *     if (!requirement) return true;
 *
 * A handler with no permission metadata is not denied — it is ALLOWED, to any
 * authenticated caller. `JwtAuthGuard` still proves *who* you are; nothing then checks
 * *whether you may*. So forgetting the decorator on a new route is not a 500 and not a
 * 403: it is a silently world-readable (or world-writable) endpoint that every test
 * still passes. That is the failure mode this counter exists to make loud.
 *
 * Note that `@Auth()` does NOT count as policed. It mounts `JwtAuthGuard` and
 * `PolicyGuard`, but mounting `PolicyGuard` without metadata for it to read is exactly
 * the case above: the guard runs and returns `true`. Most controllers carry a class-level
 * `@Auth()`, so treating it as authorization would make this counter report zero while
 * changing nothing about who may call what.
 *
 * Three shapes are legitimately undecorated, and they are why this is a ratchet rather
 * than an assertion of zero:
 *
 *  1. No principal to authorize — `/v1/bff/login`, `auth/refresh` and the signature-
 *     authenticated `webhooks/inbound` all run before, or without, an identity.
 *     `health` is explicitly `@Public`, so it already counts as policed.
 *  2. Self-scoped by construction — the subject IS the caller, so there is no cross-user
 *     access to authorize: `authz/delegations` (writes `fromUserId: user.sub`, reads
 *     `listFrom(user.sub)`), `notifications/*`, `notification-preferences/*`,
 *     `access-requests/grants/me/active`, `auth/me`, and both logout routes.
 *  3. Permission resolved at RUN TIME, so no static decorator can name it —
 *     `requests/:id/{approve,reject}` is the whole reason this bucket exists. The
 *     required permission comes from the request TYPE and the current approval STEP
 *     (`stepDef.requiredPermission ?? def.requiredApprovalPermission`), and the check
 *     unions the actor with an active delegator and enforces separation of duties. See
 *     `RequestEngine.approve` in libs/platform/src/requests/request-engine.service.ts.
 *
 * Everything else in the current count is a gap, not a design. Three are confirmed by
 * reading the service, and are the reason this file exists rather than a clean-up commit:
 *
 *  - `GET workforce/{timesheets,leave,overtime,shifts}` accept an `employeeId` QUERY
 *    filter and pass it to the repository untouched — no actor reaches the service at
 *    all. Any authenticated employee can read any other employee's HR records. The
 *    sibling `POST workforce/leave/:id/review` DOES carry `@RequirePermission`, so the
 *    module knows the pattern; the read paths were simply missed.
 *  - `POST workforce/timesheets/:id/submit` takes `_actor` and discards it, so anyone
 *    can submit anyone's draft.
 *  - `POST employees/:id/avatar/{presign,confirm}` take `employeeId` from the path behind
 *    a 404 guard only; `actor` is recorded as the uploader, never checked against the
 *    subject. Any authenticated user can replace any employee's photo. Both routes
 *    already document a 403 via `@ApiCommonErrors` that cannot be produced.
 *
 * The counter reads SOURCE TEXT. It cannot tell a correct permission code from a
 * misspelled one, and it cannot see authorization that lives inside a service. It is a
 * smoke detector, not an authorization test — the e2e suites are that.
 */

// ── Baseline — LOWER as routes get decorated, NEVER raise ─────────────────────
//
// Raising this number is forbidden. If you are here because your change made the count
// rise, the fix is to decorate the route, not to edit this line. The ONE shape that could
// justify a rise is authorization MOVING INTO A SERVICE because no decorator can express
// it (a run-time-resolved permission, as in bucket 3 above) — and then the move must be
// pinned by an e2e spec asserting BOTH directions, and named in this docblock.
//
// This baseline is a DEBT MARKER, not a target. It was set to the count that existed when
// the scanner was written, so that the surface stops growing while the gaps listed above
// are closed one module at a time.
const MAX_UNPOLICED_ROUTES = 46;

/** Sanity floor: if the scanner stops finding routes, fail loudly, not silently. */
const MIN_ROUTES_FOUND = 100;

const ROOT = join(__dirname, '..');
const HTTP_METHOD = /^\s*@(Get|Post|Patch|Put|Delete)\(/;
const DECORATOR = /^\s*@\w+\(/;
const HANDLER = /^\s*(?:async\s+)?[\w[\]'"]+\s*\(/;
/**
 * Anchored to the start of the line (modulo indent) so it matches a real decorator and
 * not prose: an unanchored /@RequirePermission/ also matches the doc comments that
 * mention the decorator by name, which would silently mark whole controllers as policed.
 */
const POLICY = /^\s*@(RequirePermission|Public)\b/;
const COMMENT = /^\s*(\/\/|\/?\*)/;

interface Route {
  file: string;
  line: number;
  signature: string;
}

function scanRoutes(): { all: Route[]; unpoliced: Route[] } {
  const files = execFileSync('git', ['ls-files', '*.controller.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);

  const all: Route[] = [];
  const unpoliced: Route[] = [];

  for (const file of files) {
    const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');

    // A class-level @RequirePermission or @Public covers every handler in the file
    // (Reflector.getAllAndOverride reads handler THEN class), so honour it rather than
    // reporting every route in that controller as a false positive.
    const classDeclaration = lines.findIndex((l) => /^export class/.test(l));
    const classPolicied =
      classDeclaration > 0 &&
      lines.slice(0, classDeclaration).some((l) => !COMMENT.test(l) && POLICY.test(l));

    for (let i = 0; i < lines.length; i++) {
      if (!HTTP_METHOD.test(lines[i])) continue;

      // Everything between the HTTP verb and the handler signature is this route's
      // decorator block.
      const decorators: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (COMMENT.test(lines[j])) continue;
        if (DECORATOR.test(lines[j])) decorators.push(lines[j]);
        else if (HANDLER.test(lines[j])) break;
      }

      const route = { file, line: i + 1, signature: lines[i].trim() };
      all.push(route);
      // Per line, not against the joined block: POLICY is `^`-anchored and has no `m`
      // flag, so testing the join would only ever match the FIRST decorator of a route.
      if (!classPolicied && !decorators.some((d) => POLICY.test(d))) unpoliced.push(route);
    }
  }

  return { all, unpoliced };
}

function report(routes: Route[]): string {
  const byFile = new Map<string, string[]>();
  for (const r of routes) {
    byFile.set(r.file, [...(byFile.get(r.file) ?? []), `${r.signature}  (line ${r.line})`]);
  }
  return [...byFile.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([file, rs]) => `  ${file}\n${rs.map((r) => `      ${r}`).join('\n')}`)
    .join('\n');
}

describe('route-policy ratchet (only ever decreases)', () => {
  it('finds the controller surface it claims to guard', () => {
    const { all } = scanRoutes();
    expect(
      all.length,
      'Found almost no route handlers. The scanner is broken, not the controllers.',
    ).toBeGreaterThanOrEqual(MIN_ROUTES_FOUND);
  });

  it(`route handlers with neither @RequirePermission nor @Public <= ${MAX_UNPOLICED_ROUTES}`, () => {
    const { unpoliced } = scanRoutes();

    if (unpoliced.length > MAX_UNPOLICED_ROUTES) {
      throw new Error(
        `Unpoliced routes rose to ${unpoliced.length} (baseline ${MAX_UNPOLICED_ROUTES}).\n` +
          `PolicyGuard ALLOWS a handler with no policy metadata, so a new route without ` +
          `@RequirePermission is open to every authenticated caller. Add the decorator — ` +
          `do not raise the baseline.\n\n${report(unpoliced)}`,
      );
    }

    expect(unpoliced.length).toBeLessThanOrEqual(MAX_UNPOLICED_ROUTES);
  });
});
