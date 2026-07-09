import { z } from 'zod';

const booleanish = (defaultValue: boolean) =>
  z
    .string()
    .default(String(defaultValue))
    .transform((v) => v === 'true');

/**
 * Treat an empty-string env var as "unset" so that `.optional()` fields disabled
 * via blank values (e.g. SSO left unconfigured) don't trip format validators.
 */
const emptyToUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema);

/**
 * Validated environment schema.
 * The process refuses to start if any required variable is missing or malformed.
 */
export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default('0.0.0.0'),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),

    // ── Database ───────────────────────────────────────────────────────────────
    DATABASE_URL: z.string().url(),
    DATABASE_POOL_MIN: z.coerce.number().int().positive().default(2),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),

    // ── Auth ───────────────────────────────────────────────────────────────────
    // JWT — ES256 asymmetric signing (ECDSA over NIST P-256 / prime256v1).
    // Keys must be PEM-encoded EC P-256 keypair. Accepted as raw PEM or base64-encoded PEM.
    // Generate: openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt
    JWT_PRIVATE_KEY: z
      .string()
      .min(1)
      .transform((v) => (v.includes('-----BEGIN') ? v : Buffer.from(v, 'base64').toString('utf8')))
      .refine((v) => v.includes('-----BEGIN'), 'JWT_PRIVATE_KEY must be a PEM-encoded private key'),
    JWT_PUBLIC_KEY: z
      .string()
      .min(1)
      .transform((v) => (v.includes('-----BEGIN') ? v : Buffer.from(v, 'base64').toString('utf8')))
      .refine((v) => v.includes('-----BEGIN'), 'JWT_PUBLIC_KEY must be a PEM-encoded public key'),

    // Entra ID SSO — required in production, optional in dev (enables entra-login endpoint).
    ENTRA_TENANT_ID: emptyToUndefined(z.string().uuid().optional()),
    ENTRA_CLIENT_ID: emptyToUndefined(z.string().uuid().optional()),
    /** Microsoft Graph app client secret — client-credentials flow for Graph sync jobs (compliance, security-posture, workforce). Optional; features self-disable when unset. */
    GRAPH_CLIENT_SECRET: z.string().min(1).optional(),
    // Used to sign fastify-cookie (required for CSRF signed cookies).
    COOKIE_SECRET: z.string().min(32),
    /** Short-lived access token — 15 min is enterprise standard (token theft window). */
    JWT_ACCESS_EXPIRY: z.string().default('15m'),
    /** Refresh token TTL in days — stored as HttpOnly cookie, hashed in DB, revocable. */
    JWT_REFRESH_EXPIRY_DAYS: z.coerce.number().int().positive().default(7),
    JWT_ISSUER: z.string().default('opshub-api'),
    JWT_AUDIENCE: z.string().default('opshub-web'),

    // ── AWS (optional in dev) ──────────────────────────────────────────────────
    AWS_REGION: z.string().default('ap-southeast-1'),
    SQS_OUTBOX_URL: z.string().optional(),
    /** S3 bucket for all stored files — injected by infra as S3_FILES_BUCKET. Optional in dev (uploads stubbed when unset). */
    S3_FILES_BUCKET: z.string().optional(),
    /** CloudFront base URL for file downloads. When set, overrides presigned S3 GET URLs. */
    CDN_FILES_BASE_URL: z.string().optional(),

    // ── Observability ──────────────────────────────────────────────────────────
    SERVICE_VERSION: z.string().default('dev'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    LOG_PRETTY: booleanish(false),
    LOG_SQL: booleanish(false),
    OTEL_ENABLED: booleanish(false),
    OTEL_SERVICE_NAME: z.string().default('opshub-api'),
    OTEL_WORKER_SERVICE_NAME: z.string().default('opshub-worker'),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),

    // ── Cache (Valkey / Redis — optional in dev) ───────────────────────────────
    REDIS_URL: z.string().optional(),
    /** Alias for REDIS_URL injected by infra as VALKEY_URL. Resolved into REDIS_URL at startup. */
    VALKEY_URL: z.string().optional(),
    REDIS_KEY_PREFIX: z.string().default('opshub:'),

    // ── Background jobs ────────────────────────────────────────────────────────
    /** Audit log retention in days (SOC 2 baseline: 730 = 2 years). */
    AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(730),

    // ── AI assistant (optional) ────────────────────────────────────────────────
    // When ANTHROPIC_API_KEY is unset the AI module reports itself disabled
    // (AiService.isEnabled()) and the /ai endpoints return 503.
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default('claude-opus-4-8'),

    // ── Email ──────────────────────────────────────────────────────────────────
    EMAIL_PROVIDER: z.enum(['dev', 'resend']).default('dev'),
    MAIL_FROM_NAME: z.string().default('OpsHub'),
    MAIL_FROM_EMAIL: z.string().email().default('no-reply@opshub.app'),
    MAIL_REPLY_TO: z.string().email().optional(),
    RESEND_API_KEY: z.string().optional(),

    // ── Frontend ───────────────────────────────────────────────────────────────
    /** Public base URL used to build links inside notification emails. */
    APP_URL: z.string().url().default('http://localhost:5173'),
  })
  .transform((data) => ({
    ...data,
    // VALKEY_URL is the infra-injected alias for Redis-compatible caches (e.g. ElastiCache Valkey).
    // Normalize at parse time so all callers use get('REDIS_URL') regardless of which var infra sets.
    REDIS_URL: data.VALKEY_URL ?? data.REDIS_URL,
  }));

export type Env = z.infer<typeof EnvSchema>;
