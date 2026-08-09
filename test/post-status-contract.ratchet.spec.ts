import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, basename } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * POST status-code ratchet — a route must RETURN the status it DOCUMENTS.
 *
 * Nest answers 201 for every `@Post` unless told otherwise. Most POST routes here are not
 * creations: `approve`, `reject`, `cancel`, `assign`, `retire`, `acknowledge`, `activate`,
 * `renew`, `terminate` are state TRANSITIONS, and they are annotated `@ApiOkResponse`, which
 * promises 200. Without `@HttpCode(HttpStatus.OK)` the annotation is simply false.
 *
 * MEASURED, not theorised. `POST /v1/documents/versions/{id}/submit` advertised exactly one
 * success status in `/api/docs-json`:
 *
 *     "responses": { "200": {...}, "401": {...}, "404": {...}, "412": {...} }
 *
 * and answered `201` when called. 14 more routes across five controllers did the same.
 *
 * WHY IT MATTERS RATHER THAN BEING COSMETIC. `apps/web/src/shared/api/generated/api.ts` is
 * generated FROM that document, so the client types the success payload under 200 while the
 * server sends it under 201. `openapi-fetch` reads the body regardless, which is exactly what
 * makes this survive: nothing breaks until something checks the status — a retry policy, a
 * cache rule keyed on 201-means-created, a strict SDK, or a test asserting the contract. And
 * every one of those breaks far from the cause.
 *
 * THE RULE: a `@Post` handler annotated `@ApiOkResponse` must also declare `@HttpCode`.
 * A genuine creation keeps `@ApiCreatedResponse` and needs nothing — the two annotations are
 * how a route states which it is.
 *
 * BASELINE IS ZERO and must stay there. The fix is one decorator; an exemption list would just
 * be a list of routes whose documentation lies.
 */

// ── Baseline — MUST stay 0 ───────────────────────────────────────────────────
const MAX_MISMATCHES = 0;

/**
 * Sanity floor: if the scanner stops finding POST handlers at all — a moved directory, a
 * renamed decorator — it would report zero mismatches and pass while checking nothing.
 */
const MIN_POST_HANDLERS_FOUND = 40;

const ROOT = join(__dirname, '..');

interface Handler {
  file: string;
  route: string;
  documentsOk: boolean;
  declaresHttpCode: boolean;
}

/** Every controller source tracked by git — `git ls-files` so a stray build artefact is ignored. */
function controllerFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '*.controller.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean);
}

/**
 * Split a controller into per-handler blocks.
 *
 * Handlers are delimited by their method decorator at two-space indentation, which is what every
 * controller in this repo uses. Anything before the first one (imports, the class declaration,
 * mapper functions) is discarded, so a `@HttpCode` in a comment at the top of the file cannot
 * make a route look compliant.
 */
function handlers(source: string, file: string): Handler[] {
  const blocks = source.split(/\n(?= {2}@(?:Get|Post|Put|Patch|Delete)\()/).slice(1);
  const found: Handler[] = [];

  for (const block of blocks) {
    const post = /^ {2}@Post\(([^)]*)\)/.exec(block);
    if (!post) continue;

    // Only the DECORATOR section counts — up to the handler signature. A `@HttpCode` further down
    // would be inside another handler's block.
    const decorators = block.split(/\n {2}(?:async |[a-zA-Z]+\()/)[0];
    found.push({
      file: basename(file),
      route: post[1].replace(/['"]/g, '') || '/',
      documentsOk: decorators.includes('@ApiOkResponse'),
      declaresHttpCode: decorators.includes('@HttpCode'),
    });
  }
  return found;
}

describe('POST routes return the status they document', () => {
  const all = controllerFiles().flatMap((f) => handlers(readFileSync(join(ROOT, f), 'utf8'), f));

  it('finds POST handlers to check', () => {
    expect(all.length).toBeGreaterThanOrEqual(MIN_POST_HANDLERS_FOUND);
  });

  it('has no @ApiOkResponse POST without @HttpCode', () => {
    const mismatched = all.filter((h) => h.documentsOk && !h.declaresHttpCode);

    expect(
      mismatched.length,
      mismatched.length === 0
        ? ''
        : `These POST routes promise 200 in the OpenAPI document and return Nest's default 201:\n` +
            mismatched.map((h) => `  ${h.file} @Post('${h.route}')`).join('\n') +
            `\n\nAdd @HttpCode(HttpStatus.OK) — or, if the route really does create something, ` +
            `annotate it @ApiCreatedResponse instead.`,
    ).toBeLessThanOrEqual(MAX_MISMATCHES);
  });
});
