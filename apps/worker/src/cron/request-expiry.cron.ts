import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { RequestEngine } from '@platform';

/**
 * Expiry cron — runs every 5 minutes and transitions pending/in_review
 * requests past their `expires_at` deadline to `expired`. Calls the
 * domain TypeDef's `onExpire` hook inside a transaction for each row.
 *
 * Designed to be idempotent: `RequestEngine.expire()` is a no-op if the
 * request is already in a terminal state.
 */
@Injectable()
export class RequestExpiryCron {
  private readonly logger = new Logger(RequestExpiryCron.name);
  private running = false;

  constructor(private readonly engine: RequestEngine) {}

  @Interval(5 * 60_000) // every 5 minutes
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const ids = await this.engine.findExpired(100);
      if (ids.length === 0) return;

      let expired = 0;
      for (const id of ids) {
        try {
          await this.engine.expire(id);
          expired++;
        } catch (err) {
          this.logger.error({ err, requestId: id }, 'Failed to expire request — skipping');
        }
      }
      if (expired > 0) this.logger.log(`Expired ${expired} request(s)`);
    } finally {
      this.running = false;
    }
  }
}
