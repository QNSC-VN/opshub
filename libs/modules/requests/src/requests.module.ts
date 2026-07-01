import { Module } from '@nestjs/common';
import { AuditModule } from '@modules/audit';
import { RequestsController } from './interface/http/requests.controller';

/**
 * Unified requests inbox module.
 *
 * No own service/repo needed — the RequestEngine lives in the global
 * PlatformModule and is injected directly into the controller.
 */
@Module({
  imports: [AuditModule],
  controllers: [RequestsController],
})
export class RequestsModule {}
