import { Module } from '@nestjs/common';
import { AuditModule } from '@modules/audit';
import { WebhooksService } from './application/webhooks.service';
import { WebhookRelayService } from './application/webhook-relay.service';
import { WebhooksController } from './interface/http/webhooks.controller';

@Module({
  imports: [AuditModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookRelayService],
})
export class WebhooksModule {}
