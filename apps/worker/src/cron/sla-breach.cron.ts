import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { and, eq, isNull, lte, inArray } from 'drizzle-orm';
import { InjectDrizzle, type DrizzleDB } from '@platform';
import { NotificationSchedulerService } from '@platform';
import { requestItems } from '../../../../db/schema';

/**
 * SlaBreachCron — runs every 15 minutes to detect requests that have
 * exceeded their SLA deadline without a decision.
 *
 * Actions on breach:
 *  1. Marks `sla_breached_at = now()` so each request is only processed once.
 *  2. Sends a `request.sla_breach` notification to the requester.
 *
 * SLA breach is notification-only. Expiry (auto-cancel) is handled by
 * the separate `RequestExpiryCron`.
 */
@Injectable()
export class SlaBreachCron {
  private readonly logger = new Logger(SlaBreachCron.name);
  private running = false;

  constructor(
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly notifScheduler: NotificationSchedulerService,
  ) {}

  @Interval(15 * 60_000) // every 15 minutes
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.process();
    } finally {
      this.running = false;
    }
  }

  private async process(): Promise<void> {
    const now = new Date();

    // Find pending/in_review requests that have a SLA deadline in the past
    // and have not been marked as breached yet.
    const breached = await this.db
      .select({
        id: requestItems.id,
        type: requestItems.type,
        requesterId: requestItems.requesterId,
        slaDeadline: requestItems.slaDeadline,
      })
      .from(requestItems)
      .where(
        and(
          inArray(requestItems.status, ['pending', 'in_review']),
          isNull(requestItems.slaBreachedAt),
          lte(requestItems.slaDeadline, now),
        ),
      )
      .limit(100);

    if (breached.length === 0) return;

    let notified = 0;
    for (const row of breached) {
      if (!row.slaDeadline) continue; // type-narrowing guard
      try {
        await this.db.transaction(async (tx) => {
          await tx
            .update(requestItems)
            .set({ slaBreachedAt: now })
            .where(eq(requestItems.id, row.id));

          await this.notifScheduler.schedule(tx, {
            type: 'request.sla_breach',
            vars: {
              requestType: row.type,
              requestId: row.id,
              deadline: row.slaDeadline!.toISOString(),
            },
            recipientId: row.requesterId,
            resourceId: row.id,
            idempotencyKey: `sla_breach:${row.id}`,
          });
        });
        notified++;
      } catch (err) {
        this.logger.error({ err, requestId: row.id }, 'SLA breach notification failed — skipping');
      }
    }

    if (notified > 0) {
      this.logger.warn(`SLA breach detected for ${notified} request(s)`);
    }
  }
}
