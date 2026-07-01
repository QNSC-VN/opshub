import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { applyDecorators, BadRequestException, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import { ErrorCodes } from '../errors/error-codes';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

// ── Request schema (offset pagination — simple and sufficient for ops volumes) ──

export const PageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.string().optional(),
});

export type PageQuery = z.infer<typeof PageQuerySchema>;

export class PageQueryDto extends createZodDto(PageQuerySchema) {}

// ── Response types ────────────────────────────────────────────────────────────

export interface PageInfo {
  total: number;
  limit: number;
  offset: number;
  hasNextPage: boolean;
}

export interface PagedResult<T> {
  data: T[];
  pageInfo: PageInfo;
}

export function buildPageResult<T>(
  data: T[],
  total: number,
  limit: number,
  offset: number,
): PagedResult<T> {
  return {
    data,
    pageInfo: { total, limit, offset, hasNextPage: offset + data.length < total },
  };
}

// ── Swagger helper for paginated responses ────────────────────────────────────

export const ApiPagedResponse = <T>(model: Type<T>) =>
  applyDecorators(
    ApiExtraModels(model),
    ApiOkResponse({
      description: 'Paginated list',
      schema: {
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(model) } },
          pageInfo: {
            type: 'object',
            required: ['total', 'limit', 'offset', 'hasNextPage'],
            properties: {
              total: { type: 'number' },
              limit: { type: 'number' },
              offset: { type: 'number' },
              hasNextPage: { type: 'boolean' },
            },
          },
        },
      },
    }),
  );

// ── Cursor-based pagination ──────────────────────────────────────────────────
//
// Cursor pagination is preferable over offset for:
//   - Large datasets where OFFSET N is expensive (full index scan)
//   - Live feeds where concurrent inserts skew offset results
//   - Security: opaque cursors prevent clients from probing row counts
//
// Cursors are base64url-encoded JSON snapshots of the last-seen sort key(s).
// They are opaque to clients — never expose the raw field values.

/**
 * Encode arbitrary sort-key fields into an opaque, URL-safe cursor string.
 *
 * @example
 *   const cursor = encodeCursor({ id: row.id, createdAt: row.createdAt.toISOString() });
 */
export function encodeCursor(fields: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(fields)).toString('base64url');
}

/**
 * Decode a cursor back into the original fields.
 * Throws `BadRequestException` (INVALID_CURSOR) on malformed input.
 */
export function decodeCursor<T = Record<string, unknown>>(cursor: string): T {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    return JSON.parse(json) as T;
  } catch {
    throw new BadRequestException(ErrorCodes.INVALID_CURSOR, 'Invalid pagination cursor');
  }
}

export interface CursorPageInfo {
  /** Whether another page exists after the current one */
  hasNextPage: boolean;
  /** Cursor pointing to the last item in this page; null when hasNextPage is false */
  endCursor: string | null;
}

export interface CursorPagedResult<T> {
  data: T[];
  pageInfo: CursorPageInfo;
}

/**
 * Build a cursor-paged result from a fetched slice.
 *
 * Callers should fetch `limit + 1` rows — the extra row signals hasNextPage
 * without requiring a separate COUNT query.
 *
 * @param rows         The `limit + 1` rows fetched from the DB
 * @param limit        The requested page size
 * @param cursorField  Function that extracts cursor fields from the last real row
 *
 * @example
 *   const rows = await db.query.assets.findMany({ limit: limit + 1, ... });
 *   return buildCursorResult(rows, limit, (r) => ({ id: r.id }));
 */
export function buildCursorResult<T>(
  rows: T[],
  limit: number,
  cursorField: (lastRow: T) => Record<string, unknown>,
): CursorPagedResult<T> {
  const hasNextPage = rows.length > limit;
  const data = hasNextPage ? rows.slice(0, limit) : rows;
  const lastRow = data.at(-1);
  return {
    data,
    pageInfo: {
      hasNextPage,
      endCursor: hasNextPage && lastRow ? encodeCursor(cursorField(lastRow)) : null,
    },
  };
}
