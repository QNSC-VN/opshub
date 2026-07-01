import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoLogger));
  app.enableShutdownHooks();
  app.get(PinoLogger).log('OpsHub worker started (outbox relay + scheduled jobs)');
}

main().catch((err) => {
   
  console.error('Fatal worker bootstrap error', err);
  process.exit(1);
});
