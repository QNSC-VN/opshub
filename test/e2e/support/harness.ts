/**
 * Shared e2e harness: boot the REAL API in-process and drive it over REAL HTTP.
 *
 * Every e2e spec goes through here rather than assembling its own Nest app, for one
 * reason: an app assembled by hand is a DIFFERENT app. Miss `app.register(fastifyCookie)`
 * and the CSRF hook cannot read a cookie, so a spec asserting CSRF protection passes
 * against a server that could never have enforced it. `bootstrapApp` is the same function
 * `apps/api/src/main.ts` calls, so the helmet headers, the cookie plugin, the ONE CSRF
 * `onRequest` hook, CORS and the `/v1` prefix are all present exactly as in production.
 *
 * `app.inject()` rather than a listening socket: the full Fastify lifecycle runs — hooks,
 * guards, interceptors, pipes, filters — with no port to allocate and no race to poll.
 *
 * Nothing is stubbed. Tokens come from `POST /v1/auth/dev-login`, which the shared
 * AuthService refuses whenever `NODE_ENV === 'production'`, so the specs authenticate as
 * the real seeded fixtures with real signed JWTs and real permission resolution.
 *
 * Prereqs: `docker compose -f docker-compose.dev.yml up -d` and `pnpm db:seed`.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { CacheService } from '@qnsc-vn/platform-cache';
import { RATE_LIMIT_TIERS } from '@platform';
import { AppModule } from '../../../apps/api/src/app.module';
import { bootstrapApp } from '../../../apps/api/src/bootstrap/app.bootstrap';

/**
 * Seeded demo employees (`db/seed.ts`), addressed by the tier they represent rather than
 * by name — a spec should read as "the caller who holds nothing", not "employee 8".
 *
 *  - `NO_PERMISSIONS` holds the `employee` role, whose permission bundle is EMPTY by
 *    design: self-service is expressed by scope, not by a permission code.
 *  - `HR` holds `workforce.read` and `workforce.approve` GLOBALLY, so it is the
 *    unconstrained tier every narrowing check has to let through.
 */
export const FIXTURE = {
  NO_PERMISSIONS: {
    id: '00000000-0000-7000-8000-000000000008',
    email: 'employee@opshub.local',
  },
  HR: {
    id: '00000000-0000-7000-8000-000000000004',
    email: 'hr@opshub.local',
  },
  ADMIN: {
    id: '00000000-0000-7000-8000-000000000001',
    email: 'admin@opshub.local',
  },
  /**
   * Holds the READ half of several bundles without the MANAGE half — `position.read` but not
   * `position.manage`, `workforce.read` but not `workforce.manage`.
   *
   * The tier that catches a route guarded by the wrong permission of a pair. `NO_PERMISSIONS`
   * cannot: it is rejected by either code, so a 403 for it proves nothing about WHICH one was
   * required.
   */
  MANAGER: {
    id: '00000000-0000-7000-8000-000000000005',
    email: 'manager@opshub.local',
  },
  /**
   * Holds `documents.manage`, `documents.approve` and `documents.publish` — the ISMS owner, and
   * the AUTHOR in the controlled-document specs. Kept distinct from ADMIN on purpose: separation
   * of duties can only be tested with two identities, since an author may not approve their own
   * policy.
   */
  SECURITY: {
    id: '00000000-0000-7000-8000-000000000003',
    email: 'security@opshub.local',
  },
} as const;

export async function createTestApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, trustProxy: true }),
    { bufferLogs: true, logger: false },
  );
  await bootstrapApp(app);
  await app.init();
  // Fastify only builds its routing table and runs plugin `onReady` hooks here. Without
  // it `inject()` on a freshly created app can 404 a route that is in fact registered.
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/**
 * Clear EVERY rate-limit bucket this suite can fill — all tiers, all fixtures, and the IP.
 *
 * The counters live in Valkey, which OUTLIVES the test process, so they accumulate across
 * runs. Two failure modes, both measured rather than predicted:
 *
 *   • `AUTH_LOGIN` allows 5 attempts per 15 minutes per IP. Every spec file logs in as two
 *     or three fixtures, so the third run inside one window fails with a 429 — surfacing as
 *     `dev-login failed`, which reads exactly like an unseeded database.
 *   • `DEFAULT` allows 200 requests per minute per userId. One full suite pass is well over
 *     100 requests as `hr` alone, so a SECOND pass started inside the same minute 429s partway
 *     in, on whichever spec happens to be running. Clearing only the login tier left this half
 *     of the problem in place, and it cost a debugging round today.
 *
 * Tiers come from `RATE_LIMIT_TIERS` rather than a list written out here, so a tier added
 * later is covered without anyone remembering this file. Subjects are the IP plus every
 * fixture id, because a tier keyed by `userId` buckets per caller — and `app.inject()` has no
 * socket, so Fastify reports `127.0.0.1` for the ip-keyed ones.
 *
 * Goes through the app's own `CacheService.del`, not a raw client, so the namespace prefix
 * and the `rl:` key shape stay in ONE place: `consumeRateLimit` builds the same key, and a
 * hard-coded string here would silently stop matching if either changed.
 */
async function clearRateLimits(app: NestFastifyApplication): Promise<void> {
  const subjects = ['127.0.0.1', ...Object.values(FIXTURE).map((f) => f.id)];
  try {
    const cache = app.get(CacheService);
    await Promise.all(
      Object.keys(RATE_LIMIT_TIERS).flatMap((tier) =>
        subjects.map((subject) => cache.del(`rl:${tier}:${subject}`)),
      ),
    );
  } catch {
    // Cache optional in some configurations; the limiter fails open there anyway.
  }
}

/** A dev-login result: the bearer token plus the cookies the login set. */
export interface Session {
  accessToken: string;
  /** Raw `set-cookie` values, for specs that need to replay them (CSRF, refresh). */
  cookies: string[];
  /** `name=value; name=value` — ready for a `cookie` request header. */
  cookieHeader: string;
}

/**
 * Authenticate as a seeded fixture and return everything needed to act as them.
 *
 * Throws on a non-200 instead of returning a token-less session: a spec that silently
 * continues unauthenticated would then assert a 403 and pass for the wrong reason, which
 * is the exact failure mode an authorization suite must not have.
 */
export async function login(
  app: NestFastifyApplication,
  fixture: { email: string },
): Promise<Session> {
  await clearRateLimits(app);

  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/dev-login',
    payload: { email: fixture.email },
  });

  if (res.statusCode !== 200) {
    throw new Error(
      `dev-login failed for ${fixture.email}: ${res.statusCode} ${res.body}. ` +
        'Is the database seeded (`pnpm db:seed`)? Is NODE_ENV production?',
    );
  }

  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return {
    accessToken: (JSON.parse(res.body) as { accessToken: string }).accessToken,
    cookies,
    cookieHeader: cookies.map((c) => c.split(';')[0]).join('; '),
  };
}

/** Bearer authorization header for a session. */
export function bearer(session: Session): Record<string, string> {
  return { authorization: `Bearer ${session.accessToken}` };
}
