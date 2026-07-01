// OTel must be imported before any other module — registers auto-instrumentation
import '@platform/observability/otel';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfigService } from '@platform';
import { bootstrapApp } from './bootstrap/app.bootstrap';

async function main(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: true,
      // Explicit body limit — prevents zip-bomb / oversized payload attacks (OWASP A04)
      bodyLimit: 10 * 1024 * 1024, // 10 MB; tighten per-route if needed
    }),
    { bufferLogs: true },
  );

  await bootstrapApp(app);

  const config = app.get(AppConfigService);
  const logger = app.get(PinoLogger);
  const port = config.get('PORT');
  const host = config.get('HOST');

  await app.listen(port, host);
  logger.log(`OpsHub API listening on http://${host}:${port} (docs: /api/docs)`);
}

main().catch((err) => {
   
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
