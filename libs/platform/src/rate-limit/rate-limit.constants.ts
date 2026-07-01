export const RATE_LIMIT_TIER = Symbol('RATE_LIMIT_TIER');
export const SKIP_RATE_LIMIT = Symbol('SKIP_RATE_LIMIT');

export interface RateLimitTier {
  /** Display name used in logs and RFC 6585 headers */
  name: string;
  /** Sliding-window size in milliseconds */
  windowMs: number;
  /** Max allowed requests within the window */
  limit: number;
  /**
   * How to derive the rate-limit key.
   * - 'ip'           — client IP (default; used for pre-auth endpoints)
   * - 'userId'       — JWT sub (post-auth; NAT-safe)
   * - 'refreshToken' — SHA-256 of the refresh_token cookie (per-session;
   *                    NAT-safe without needing a decoded JWT)
   */
  keyBy?: 'ip' | 'userId' | 'refreshToken';
}

/**
 * Named tiers for intent-based rate limiting.
 * Append-only — never remove or change semantics of an existing tier name.
 */
export const RATE_LIMIT_TIERS = {
  /** Default: most read/write endpoints — 200 req/min per userId */
  DEFAULT: { name: 'DEFAULT', windowMs: 60_000, limit: 200 },
  /** Strict: expensive search/list endpoints — 60 req/min per userId */
  STRICT: { name: 'STRICT', windowMs: 60_000, limit: 60 },
  /** Auth login: brute-force protection — 5 attempts / 15 min per IP */
  AUTH_LOGIN: { name: 'AUTH_LOGIN', windowMs: 15 * 60_000, limit: 5, keyBy: 'ip' },
  /**
   * Token refresh — 30 req/min per session (keyed by refresh token hash).
   * Per-session keying is NAT-safe: each browser session gets its own bucket,
   * so 300 employees behind the same corporate proxy each still get 30/min.
   */
  AUTH_REFRESH: { name: 'AUTH_REFRESH', windowMs: 60_000, limit: 30, keyBy: 'refreshToken' },
  /** AI chat — LLM calls are expensive; 10 req/min per userId to cap inference cost. */
  AI: { name: 'AI', windowMs: 60_000, limit: 10, keyBy: 'userId' },
  /** File upload presign/confirm — S3 PUT costs; 30 req/min per userId. */
  UPLOAD: { name: 'UPLOAD', windowMs: 60_000, limit: 30, keyBy: 'userId' },
} as const satisfies Record<string, RateLimitTier>;

export type RateLimitTierName = keyof typeof RATE_LIMIT_TIERS;
