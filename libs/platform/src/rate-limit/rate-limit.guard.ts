import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { CacheService } from '@qnsc-vn/platform-cache';
import {
  RATE_LIMIT_TIER,
  SKIP_RATE_LIMIT,
  RATE_LIMIT_TIERS,
  type RateLimitTierName,
} from './rate-limit.constants';
import type { JwtPayload } from '../auth/jwt.strategy';

/**
 * Global rate-limit guard backed by the shared sliding-window limiter
 * (@qnsc-vn/platform-cache `consumeRateLimit`, an atomic sorted-set log). rally
 * and opshub share the same limiter mechanism; only the tiers/policy differ.
 *
 * Key strategy (controlled by tier.keyBy):
 *  - 'userId'       — post-auth requests; NAT-safe per-user bucket (default for authenticated routes)
 *  - 'ip'           — pre-auth requests where no identity is available (AUTH_LOGIN)
 *  - 'refreshToken' — SHA-256 of the HttpOnly refresh cookie; per-session bucket that is
 *                     NAT-safe without requiring a decoded JWT (AUTH_REFRESH)
 *  - fallback: userId if present, else IP
 *
 *  - Graceful degradation: if Redis is unavailable, allow request through
 *  - RFC 6585 + draft-ietf-httpapi-ratelimit-headers compliant response headers
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly cache: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const tierName =
      this.reflector.getAllAndOverride<RateLimitTierName>(RATE_LIMIT_TIER, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'DEFAULT';
    const tier = RATE_LIMIT_TIERS[tierName] as import('./rate-limit.constants').RateLimitTier;

    const req = context.switchToHttp().getRequest<FastifyRequest & { user?: JwtPayload }>();
    const res = context.switchToHttp().getResponse<FastifyReply>();

    const userId = req.user?.sub;
    const ip =
      (req.headers['x-real-ip'] as string) ??
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.ip ??
      'unknown';

    let identifier: string;
    switch (tier.keyBy) {
      case 'ip':
        identifier = ip;
        break;
      case 'refreshToken': {
        // Hash the HttpOnly cookie so the raw token never appears in Redis keys.
        // Falls back to IP if the cookie is absent (unauthenticated probe).
        const rawCookie = (req.cookies as Record<string, string> | undefined)?.['refresh_token'];
        identifier = rawCookie
          ? createHash('sha256').update(rawCookie).digest('hex').slice(0, 32)
          : ip;
        break;
      }
      case 'userId':
        identifier = userId ?? ip;
        break;
      default:
        // Default: userId when authenticated (NAT-safe), IP otherwise
        identifier = userId ?? ip;
    }
    const rateLimitKey = `${tierName}:${identifier}`;

    // Consume one slot from the shared sliding-window limiter. The tier window is
    // defined in ms; the shared primitive takes seconds. When the cache is
    // disabled (optional mode) consumeRateLimit fails open (allowed = true).
    let allowed: boolean;
    let remaining: number;
    let resetAt: number;
    try {
      ({ allowed, remaining, resetAt } = await this.cache.consumeRateLimit(
        rateLimitKey,
        tier.limit,
        Math.ceil(tier.windowMs / 1000),
      ));
    } catch (err) {
      // Rate limiting is a protective control, not a hard dependency for serving
      // traffic. If the cache is unavailable, fail open and surface it via logs.
      this.logger.error(
        { err, key: rateLimitKey },
        'RateLimitGuard: backend unavailable — allowing request',
      );
      return true;
    }

    // RFC 6585 headers on every response
    void res.header('RateLimit-Limit', tier.limit);
    void res.header('RateLimit-Remaining', Math.max(0, remaining));
    void res.header('RateLimit-Reset', resetAt);

    if (!allowed) {
      const retryAfterSecs = Math.max(resetAt - Math.floor(Date.now() / 1000), 1);
      void res.header('Retry-After', retryAfterSecs);
      throw new HttpException(
        {
          error: {
            code: 'RATE_LIMITED',
            message: `Too many requests — retry after ${retryAfterSecs}s.`,
            retryAfter: retryAfterSecs,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
