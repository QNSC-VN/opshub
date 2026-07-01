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
import { CacheService } from '../cache/cache.service';
import {
  RATE_LIMIT_TIER,
  SKIP_RATE_LIMIT,
  RATE_LIMIT_TIERS,
  type RateLimitTierName,
} from './rate-limit.constants';
import type { JwtPayload } from '../auth/jwt.strategy';

/**
 * Atomic sliding-window rate limiter using Redis sorted sets.
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
const SLIDING_WINDOW_LUA = `
local key        = KEYS[1]
local now        = tonumber(ARGV[1])
local window     = tonumber(ARGV[2])
local limit      = tonumber(ARGV[3])
local jitter     = ARGV[4]
local windowStart = now - window

redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, now .. ':' .. jitter)
  redis.call('PEXPIRE', key, window)
  return {1, limit - count - 1, 0}
else
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retryAfterMs = math.max(0, tonumber(oldest[2]) + window - now)
  return {0, 0, math.ceil(retryAfterMs / 1000)}
end
`;

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

    const tierName = (
      this.reflector.getAllAndOverride<RateLimitTierName>(RATE_LIMIT_TIER, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'DEFAULT'
    );
    const tier = RATE_LIMIT_TIERS[tierName] as import('./rate-limit.constants').RateLimitTier;

    const req = context.switchToHttp().getRequest<FastifyRequest & { user?: JwtPayload }>();
    const res = context.switchToHttp().getResponse<FastifyReply>();

    const userId = req.user?.sub;
    const ip =
      (req.headers['x-real-ip'] as string) ??
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.ip ??
      'unknown';

    let rateLimitKey: string;
    switch (tier.keyBy) {
      case 'ip':
        rateLimitKey = `rl:${tierName}:${ip}`;
        break;
      case 'refreshToken': {
        // Hash the HttpOnly cookie so the raw token never appears in Redis keys.
        // Falls back to IP if the cookie is absent (unauthenticated probe).
        const rawCookie = (req.cookies as Record<string, string> | undefined)?.['refresh_token'];
        const sessionKey = rawCookie
          ? createHash('sha256').update(rawCookie).digest('hex').slice(0, 32)
          : ip;
        rateLimitKey = `rl:${tierName}:${sessionKey}`;
        break;
      }
      case 'userId':
        rateLimitKey = `rl:${tierName}:${userId ?? ip}`;
        break;
      default:
        // Default: userId when authenticated (NAT-safe), IP otherwise
        rateLimitKey = `rl:${tierName}:${userId ?? ip}`;
    }

    // Degrade gracefully when Redis is unavailable
    if (!this.cache.isAvailable || !this.cache.redis) {
      this.logger.warn('RateLimitGuard: Redis unavailable — allowing request without limiting');
      return true;
    }

    const now = Date.now();
    const jitter = Math.random().toString(36).slice(2, 10);

    try {
      const [allowed, remaining, retryAfterSecs] = (await this.cache.redis.eval(
        SLIDING_WINDOW_LUA,
        1,
        rateLimitKey,
        String(now),
        String(tier.windowMs),
        String(tier.limit),
        jitter,
      )) as [number, number, number];

      // RFC 6585 headers on every response
      void res.header('RateLimit-Limit', tier.limit);
      void res.header('RateLimit-Remaining', Math.max(0, remaining));
      void res.header('RateLimit-Reset', Math.ceil((now + tier.windowMs) / 1000));

      if (!allowed) {
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
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Lua eval failure — degrade gracefully rather than blocking traffic
      this.logger.error({ err }, 'RateLimitGuard: eval failed — allowing request');
      return true;
    }
  }
}
