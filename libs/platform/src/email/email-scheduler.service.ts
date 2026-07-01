import { Injectable } from '@nestjs/common';
import { type DrizzleDB, type DbExecutor } from '../database/drizzle.provider';
import { emailOutbox } from '../../../../db/schema';
import { type EmailTemplateName, type EmailTemplateVars } from './templates';
import { NotificationPubSubService } from '../notifications/notification-pubsub.service';

/**
 * EmailSchedulerService — enqueue an email into email_outbox inside the
 * caller's existing DB transaction.
 *
 * The relay (EmailRelayService in the notifications module) reads these rows
 * every 5 s and calls EmailService.sendTemplate().
 */
@Injectable()
export class EmailSchedulerService {
  constructor(private readonly pubSub: NotificationPubSubService) {}
  async schedule<K extends EmailTemplateName>(
    tx:       DbExecutor,
    to:       string,
    template: K,
    vars:     EmailTemplateVars[K],
    opts?: { idempotencyKey?: string; scheduledAt?: Date },
  ): Promise<void> {
    // Both DrizzleDB and DrizzleTx expose .insert(); cast to narrow the overload.
    await (tx as DrizzleDB)
      .insert(emailOutbox)
      .values({
        to,
        template,
        vars:           vars as Record<string, unknown>,
        status:         'pending',
        idempotencyKey: opts?.idempotencyKey ?? null,
        scheduledAt:    opts?.scheduledAt ?? new Date(),
      })
      .onConflictDoNothing({ target: emailOutbox.idempotencyKey });

    // Best-effort wake signal — reduces relay latency from ≤5s to ~ms.
    this.pubSub.wakeEmailRelay().catch(() => { /* non-critical */ });
  }
}
