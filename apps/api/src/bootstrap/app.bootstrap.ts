import fastifyCompress from '@fastify/compress';
import fastifyCookie from '@fastify/cookie';
import fastifyCsrf from '@fastify/csrf-protection';
import fastifyHelmet from '@fastify/helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import {
  AppConfigService,
  BFF_SESSION_COOKIE,
  CSRF_HEADER,
  CSRF_SECRET_COOKIE,
  registerRequestTiming,
  requiresCsrfProtection,
} from '@platform';

/**
 * Applies cross-cutting HTTP concerns to the Fastify app: security headers,
 * compression, cookies, CSRF (double-submit cookie), CORS, the global `/v1`
 * prefix and the OpenAPI document served at `/api/docs`.
 */
export async function bootstrapApp(app: NestFastifyApplication): Promise<void> {
  const config = app.get(AppConfigService);

  app.useLogger(app.get(Logger));
  app.flushLogs();

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
      },
    },
  });
  await app.register(fastifyCompress);
  const cookieSecret = config.get('COOKIE_SECRET');
  await app.register(fastifyCookie, { secret: cookieSecret });

  // ── CSRF (double-submit, session-bound) ─────────────────────────────────────
  // The secret lives in a signed `__Host-` cookie; the token is handed to the SPA by
  // GET /v1/auth/me and echoed back in the X-CSRF-Token header. `userInfo` binds each
  // token to the session id that requested it (HMAC'd with CSRF_SECRET), so a token
  // lifted from one session cannot be replayed in another.
  //
  // Registering the plugin only decorates `reply.generateCsrf()` and
  // `app.csrfProtection` — it enforces NOTHING until the hook below attaches it.
  await app.register(fastifyCsrf, {
    sessionPlugin: '@fastify/cookie',
    cookieKey: CSRF_SECRET_COOKIE,
    cookieOpts: { signed: true, httpOnly: true, secure: true, sameSite: 'strict', path: '/' },
    // Header only. The default also reads `body._csrf`, which is never populated here and
    // would accept a token an attacker can plant in a form post.
    getToken: (req) => {
      const header = req.headers[CSRF_HEADER];
      return Array.isArray(header) ? header[0] : header;
    },
    getUserInfo: (req) => req.cookies?.[BFF_SESSION_COOKIE] ?? '',
    csrfOpts: { hmacKey: config.get('CSRF_SECRET'), userInfo: true },
  });

  // Enforce on every cookie-authenticated state-changing request. Attaching the check
  // in ONE hook rather than per route is deliberate: with decorators, a new controller
  // is unprotected until someone remembers, and the omission is invisible in review.
  // Here the default is protected and `requiresCsrfProtection` is the single place the
  // policy lives — see libs/platform/src/http/csrf.ts for which requests it selects and
  // why each exemption exists.
  const fastify = app.getHttpAdapter().getInstance();

  // Registered BEFORE the CSRF gate, and before any hook that can reject: this only
  // stamps an arrival timestamp, and it has to run on every request that reaches the
  // process — including ones something later refuses — or the access log loses the
  // arrival time for exactly the requests worth investigating.
  registerRequestTiming(fastify);

  fastify.addHook('onRequest', function csrfGate(req, reply, done) {
    if (!requiresCsrfProtection(req)) return done();
    fastify.csrfProtection(req, reply, done);
  });

  app.enableCors({
    origin: config
      .get('CORS_ORIGINS')
      .split(',')
      .map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Correlation-Id',
      'X-CSRF-Token',
      'traceparent',
      'tracestate',
      'baggage',
    ],
    exposedHeaders: ['X-Correlation-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'Retry-After'],
  });

  // Health probes are served at /v1/healthz and /v1/readyz to match the ALB
  // target-group health check, the Docker HEALTHCHECK, and the deploy smoke test.
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();

  // Expose OpenAPI only outside production — avoids leaking endpoint inventory
  if (!config.get('NODE_ENV').startsWith('prod')) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('OpsHub API')
      .setDescription('Internal operations platform — assets, access, compliance, workforce.')
      .setVersion(config.get('SERVICE_VERSION'))
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      jsonDocumentUrl: 'api/docs-json',
    });
  }
}
