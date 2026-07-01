import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { RequestContextService } from '../context/request-context';

/** Health/readiness probes — suppress from access logs to avoid noise. */
const SILENT_PREFIXES = ['/v1/healthz', '/v1/readyz', '/favicon.ico'];

/**
 * Field names that must never appear in log output (e.g. Splunk, Datadog).
 * Compared case-insensitively against request body keys.
 */
const REDACTED_BODY_FIELDS = new Set([
  'password', 'token', 'secret', 'authorization', 'cookie',
  'access_token', 'refresh_token', 'api_key', 'apikey', 'x-api-key',
]);

function redactBody(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    out[k] = REDACTED_BODY_FIELDS.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return out;
}

/**
 * Emits ONE structured access-log line per request.
 *
 * Severity mirrors HTTP status:
 *   - 5xx → ERROR (alerts / PagerDuty)
 *   - 4xx → WARN  (client errors worth monitoring)
 *   - 2xx/3xx → LOG
 *
 * Includes:
 *   - `ip`     — client IP (honouring X-Real-IP / X-Forwarded-For proxy headers)
 *   - `userId` — from ALS after JWT validation (undefined on unauthenticated routes)
 *   - `body`   — redacted request body on 4xx/5xx only (useful for debugging)
 */
@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly ctx: RequestContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const res = context.switchToHttp().getResponse<FastifyReply>();

    if (SILENT_PREFIXES.some((p) => req.url.startsWith(p))) return next.handle();

    const start = Date.now();
    const ip =
      (req.headers['x-real-ip'] as string) ??
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.ip ??
      'unknown';

    return next.handle().pipe(
      tap({
        next: () => this.emit(req, res.statusCode, start, ip),
        error: () => this.emit(req, res.statusCode || 500, start, ip),
      }),
    );
  }

  private emit(req: FastifyRequest, statusCode: number, start: number, ip: string): void {
    const userId = this.ctx.getUserId();
    const base = {
      method: req.method,
      url: req.url,
      statusCode,
      durationMs: Date.now() - start,
      ip,
      ...(userId ? { userId } : {}),
    };

    if (statusCode >= 500) {
      this.logger.error({ ...base, body: redactBody(req.body) });
    } else if (statusCode >= 400) {
      this.logger.warn({ ...base, body: redactBody(req.body) });
    } else {
      this.logger.log(base);
    }
  }
}
