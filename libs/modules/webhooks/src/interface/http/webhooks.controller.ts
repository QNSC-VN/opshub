import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermission, ApiCommonErrors, CurrentUser } from '@platform';
import type { JwtPayload } from '@platform';
import { AuditService, AUDIT_ACTION, AUDIT_RESOURCE } from '@modules/audit';
import { WebhooksService } from '../../application/webhooks.service';
import type { WebhookSubscription, WebhookDelivery } from '../../domain/webhook.types';
import {
  CreateWebhookSubscriptionDto,
  SetActiveDto,
  WebhookSubscriptionResponseDto,
  WebhookDeliveryResponseDto,
} from './dto/webhook.dto';

function toSubDto(s: WebhookSubscription): WebhookSubscriptionResponseDto {
  return {
    id: s.id,
    url: s.url,
    events: s.events,
    description: s.description,
    active: s.active,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function toDeliveryDto(d: WebhookDelivery): WebhookDeliveryResponseDto {
  return {
    id: d.id,
    subscriptionId: d.subscriptionId,
    eventType: d.eventType,
    payload: d.payload,
    status: d.status,
    attempts: d.attempts,
    nextAttemptAt: d.nextAttemptAt.toISOString(),
    deliveredAt: d.deliveredAt ? d.deliveredAt.toISOString() : null,
    lastError: d.lastError,
    createdAt: d.createdAt.toISOString(),
  };
}

@ApiTags('webhooks')
@Controller('webhooks')
@RequirePermission('webhooks.manage')
export class WebhooksController {
  constructor(
    private readonly service: WebhooksService,
    private readonly audit: AuditService,
  ) {}

  // ── Subscriptions ──────────────────────────────────────────────────────────

  @Post('subscriptions')
  @RequirePermission('webhooks.manage')
  @ApiOperation({ summary: 'Register a new outbound webhook subscription' })
  @ApiResponse({ status: 201, type: WebhookSubscriptionResponseDto })
  @ApiCommonErrors(400, 401, 403)
  async createSubscription(
    @Body() dto: CreateWebhookSubscriptionDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<WebhookSubscriptionResponseDto> {
    const sub = await this.service.create({
      url: dto.url,
      secret: dto.secret,
      events: [...dto.events],
      description: dto.description,
    });
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: AUDIT_ACTION.WEBHOOK_SUBSCRIPTION_CREATED,
      resourceType: AUDIT_RESOURCE.WEBHOOK_SUBSCRIPTION,
      resourceId: sub.id,
      metadata: { url: dto.url, events: dto.events },
    });
    return toSubDto(sub);
  }

  @Get('subscriptions')
  @RequirePermission('webhooks.manage')
  @ApiOperation({ summary: 'List all webhook subscriptions' })
  @ApiResponse({ status: 200, type: [WebhookSubscriptionResponseDto] })
  @ApiCommonErrors(401, 403)
  async listSubscriptions(): Promise<WebhookSubscriptionResponseDto[]> {
    const subs = await this.service.list();
    return subs.map(toSubDto);
  }

  @Get('subscriptions/:id')
  @RequirePermission('webhooks.manage')
  @ApiOperation({ summary: 'Get a webhook subscription by ID' })
  @ApiResponse({ status: 200, type: WebhookSubscriptionResponseDto })
  @ApiCommonErrors(401, 403, 404)
  async getSubscription(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WebhookSubscriptionResponseDto> {
    return toSubDto(await this.service.getById(id));
  }

  @Patch('subscriptions/:id/active')
  @RequirePermission('webhooks.manage')
  @ApiOperation({ summary: 'Enable or disable a webhook subscription' })
  @ApiResponse({ status: 200, type: WebhookSubscriptionResponseDto })
  @ApiCommonErrors(401, 403, 404)
  async setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetActiveDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<WebhookSubscriptionResponseDto> {
    const sub = await this.service.setActive(id, dto.active);
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: dto.active
        ? AUDIT_ACTION.WEBHOOK_SUBSCRIPTION_ENABLED
        : AUDIT_ACTION.WEBHOOK_SUBSCRIPTION_DISABLED,
      resourceType: AUDIT_RESOURCE.WEBHOOK_SUBSCRIPTION,
      resourceId: id,
    });
    return toSubDto(sub);
  }

  @Delete('subscriptions/:id')
  @RequirePermission('webhooks.manage')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a webhook subscription' })
  @ApiCommonErrors(401, 403, 404)
  async deleteSubscription(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.service.delete(id);
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: AUDIT_ACTION.WEBHOOK_SUBSCRIPTION_DELETED,
      resourceType: AUDIT_RESOURCE.WEBHOOK_SUBSCRIPTION,
      resourceId: id,
    });
  }

  // ── Deliveries ─────────────────────────────────────────────────────────────

  @Get('subscriptions/:id/deliveries')
  @RequirePermission('webhooks.manage')
  @ApiOperation({ summary: 'List recent delivery attempts for a subscription' })
  @ApiResponse({ status: 200, type: [WebhookDeliveryResponseDto] })
  @ApiCommonErrors(401, 403, 404)
  async listDeliveries(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WebhookDeliveryResponseDto[]> {
    const deliveries = await this.service.listDeliveries(id);
    return deliveries.map(toDeliveryDto);
  }

  @Post('deliveries/:id/retry')
  @RequirePermission('webhooks.manage')
  @ApiOperation({ summary: 'Manually retry a failed webhook delivery' })
  @ApiResponse({ status: 200, type: WebhookDeliveryResponseDto })
  @ApiCommonErrors(401, 403, 404)
  async retryDelivery(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<WebhookDeliveryResponseDto> {
    const delivery = await this.service.retryDelivery(id);
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: AUDIT_ACTION.WEBHOOK_DELIVERY_RETRIED,
      resourceType: AUDIT_RESOURCE.WEBHOOK_DELIVERY,
      resourceId: id,
    });
    return toDeliveryDto(delivery);
  }
}
