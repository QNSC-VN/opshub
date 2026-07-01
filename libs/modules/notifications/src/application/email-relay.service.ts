/**
 * EmailRelayService — polls email_outbox and dispatches via EmailService.
 *
 * Extends AbstractOutboxRelay which owns the polling loop, concurrency guard,
 * transaction management, and retry/fail logic.
 *
 * Adaptive polling:
 *   EmailSchedulerService.schedule() publishes an email:relay:wake signal to
 *   Redis immediately after writing to email_outbox.  onModuleInit() subscribes
 *   and calls super.relay() — delivery latency drops from ≤5s to ~ms.
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, asc, eq, lt, lte } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB, DrizzleTx } from '@platform';
import { AbstractOutboxRelay } from '@platform';
import type { PostCommitTask } from '@platform';
import { EmailService } from '@platform/email';
import type { EmailTemplateName, EmailTemplateVars } from '@platform/email';
import { NotificationPubSubService } from '@platform/notifications';
import { emailOutbox } from '../../../../../db/schema';

type EmailOutboxRow = {
  id: string;
  to: string;
  template: string;
  vars: unknown;
  attempts: number;
  idempotencyKey: string | null;
};

@Injectable()
export class EmailRelayService
  extends AbstractOutboxRelay<EmailOutboxRow>
  implements OnModuleInit, OnModuleDestroy
{
  private unsubscribeRelayWake?: () => Promise<void>;

  constructor(
    @InjectDrizzle() db: DrizzleDB,
    private readonly emailService: EmailService,
    private readonly pubSub: NotificationPubSubService,
  ) {
    super(db);
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('Email relay started — polling email_outbox every 5s');
    this.unsubscribeRelayWake = await this.pubSub.subscribeEmailRelayWake(() => {
      this.relay().catch((err: unknown) =>
        this.logger.error({ err }, 'Email relay triggered by wake signal failed'),
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.unsubscribeRelayWake?.();
  }

  @Cron('*/5 * * * * *', { name: 'email-relay' })
  override async relay(): Promise<void> {
    return super.relay();
  }

  // ── AbstractOutboxRelay implementation ────────────────────────────────────

  protected async fetchBatch(tx: DrizzleTx): Promise<EmailOutboxRow[]> {
    return tx
      .select({
        id:             emailOutbox.id,
        to:             emailOutbox.to,
        template:       emailOutbox.template,
        vars:           emailOutbox.vars,
        attempts:       emailOutbox.attempts,
        idempotencyKey: emailOutbox.idempotencyKey,
      })
      .from(emailOutbox)
      .where(and(eq(emailOutbox.status, 'pending'), lt(emailOutbox.attempts, this.maxAttempts), lte(emailOutbox.scheduledAt, new Date())))
      .orderBy(asc(emailOutbox.scheduledAt))
      .limit(this.batchSize)
      .for('update', { skipLocked: true });
  }

  protected async processRow(row: EmailOutboxRow): Promise<PostCommitTask | void> {
    await this.emailService.sendTemplate(
      row.to,
      row.template as EmailTemplateName,
      row.vars as EmailTemplateVars[EmailTemplateName],
      { idempotencyKey: row.idempotencyKey ?? row.id },
    );
    // No post-commit work needed — email dispatch is synchronous within processRow.
  }

  protected async markSent(tx: DrizzleTx, rowId: string): Promise<void> {
    await tx
      .update(emailOutbox)
      .set({ status: 'sent', sentAt: new Date() })
      .where(eq(emailOutbox.id, rowId));
  }

  protected async markFailed(
    tx: DrizzleTx,
    rowId: string,
    newAttempts: number,
    newStatus: 'pending' | 'failed',
    lastError: string,
  ): Promise<void> {
    await tx
      .update(emailOutbox)
      .set({ attempts: newAttempts, status: newStatus, lastError })
      .where(eq(emailOutbox.id, rowId));
  }
}
