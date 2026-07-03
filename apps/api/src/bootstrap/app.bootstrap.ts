import fastifyCompress from '@fastify/compress';
import fastifyCookie from '@fastify/cookie';
import fastifyCsrf from '@fastify/csrf-protection';
import fastifyHelmet from '@fastify/helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppConfigService } from '@platform';

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
  // CSRF double-submit cookie — protects state-mutating endpoints.
  await app.register(fastifyCsrf, { cookieOpts: { signed: true } });

  app.enableCors({
    origin: config.get('CORS_ORIGINS').split(',').map((o) => o.trim()),
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

  app.setGlobalPrefix('v1', { exclude: ['healthz', 'readyz'] });
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
