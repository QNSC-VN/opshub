import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { Observable, from, of } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';
import { CacheService } from '../cache/cache.service';
import type { JwtPayload } from '../auth/jwt.strategy';

const IDEMPOTENCY_TTL_SECONDS = 24 * 3600;  // 24 h
const IDEMPOTENT_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Idempotency interceptor — prevents duplicate mutations on network retry.
 *
 * Clients include an `Idempotency-Key` header (UUID recommended).
 * The response is cached per {userId}:{idempotencyKey} for 24 h.
 * A replayed request returns the cached response with `X-Idempotent-Replayed: true`.
 *
 * Skipped when:
 *   - Method is GET / DELETE (already idempotent by definition)
 *   - No `Idempotency-Key` header present (optional opt-in)
 *   - Redis is unavailable (degrade gracefully — process normally)
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly cache: CacheService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<FastifyRequest & { user?: JwtPayload }>();
    const res = context.switchToHttp().getResponse<FastifyReply>();

    if (!IDEMPOTENT_METHODS.has(req.method.toUpperCase())) return next.handle();

    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
    if (!idempotencyKey || !this.cache.isAvailable) return next.handle();

    // Scope by identity so keys are not reusable across users
    const identity = req.user?.sub ?? req.ip ?? 'anon';
    const cacheKey = `idem:${identity}:${idempotencyKey}`;

    return from(this.cache.get(cacheKey)).pipe(
      switchMap((cached) => {
        if (cached) {
          void res.header('X-Idempotent-Replayed', 'true');
          this.logger.debug({ cacheKey }, 'Idempotent replay');
          return of(JSON.parse(cached) as unknown);
        }
        return next.handle().pipe(
          tap((body) => {
            void this.cache.set(cacheKey, JSON.stringify(body), IDEMPOTENCY_TTL_SECONDS);
          }),
        );
      }),
    );
  }
}
