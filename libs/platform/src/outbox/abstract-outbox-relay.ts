/**
 * AbstractOutboxRelay — generic base class for all transactional outbox relay services.
 *
 * Encapsulates the polling machinery that is identical across every outbox-style
 * relay (email, notifications, webhooks, push, …):
 *   - Concurrency guard (isRelaying)
 *   - SELECT … FOR UPDATE SKIP LOCKED inside a DB transaction
 *   - Per-row try/catch with attempt counter and status update
 *   - Post-commit task execution (Valkey pub/sub publishes, etc.)
 *
 * Subclasses provide only domain-specific behaviour:
 *   - fetchBatch()   → SELECT from their specific outbox table
 *   - processRow()   → send email / dispatch notification / fire webhook / …
 *   - markSent()     → UPDATE row status to 'sent'
 *   - markFailed()   → UPDATE row status + attempts + last_error
 *
 * Post-commit tasks:
 *   processRow() may return a PostCommitTask (() => Promise<void>).
 *   The base class runs it AFTER the transaction commits so downstream consumers
 *   (SSE, push channels) never receive an event before the DB write is durable.
 *   Returning undefined/void means no post-commit work.
 *
 * Adding a new relay (e.g., webhook delivery):
 *   1. Create a DB outbox table and Drizzle schema entry.
 *   2. Extend AbstractOutboxRelay<WebhookRow>.
 *   3. Implement the 4 abstract methods.
 *   4. Decorate the relay() override with @Cron + @Span.
 *   5. Register the class as a provider in the module.
 */
import { Logger } from '@nestjs/common';
import type { DrizzleDB, DrizzleTx } from '../database/drizzle.provider';

/** Optional callback returned by processRow() to run after the transaction commits. */
export type PostCommitTask = () => Promise<void>;

/**
 * Log field marking a row that has exhausted `maxAttempts` and will never be retried.
 *
 * A dead-lettered row is silent work loss: an email nobody receives, a notification
 * nobody sees, an outbox event that never reaches its consumer. The row records it,
 * but only for someone who thinks to query `status = 'failed'` — so in practice the
 * queue stops doing its job and the first symptom is a user asking why.
 *
 * A distinct field rather than a distinguishable message, because a CloudWatch metric
 * filter matches structured fields, and pattern-matching on prose breaks the day
 * someone rewords a log line.
 *
 * NOTE: unlike rally, opshub has no CloudWatch alarm wired to this yet — it has no
 * alarm infrastructure at all. The field is the half that belongs in shared
 * boilerplate; the metric filter and alarm are an infra follow-up, tracked in
 * OPSHUB_RALLY_PARITY_PLAN.md. Until then this is greppable but not alerting.
 */
export const DEAD_LETTER_FIELD = 'outboxDeadLetter';

export abstract class AbstractOutboxRelay<TRow extends { id: string; attempts: number }> {
  /** Override in subclass to tune per-relay. */
  protected readonly maxAttempts: number = 5;
  protected readonly batchSize: number = 50;

  protected readonly logger: Logger;
  private isRelaying = false;
  /**
   * Set to true when relay() is called while isRelaying=true.
   * Guarantees one more relay run after the current one completes so that rows
   * inserted during a long relay batch are not left waiting for the next cron
   * tick (up to 5 s).  Uses setImmediate to avoid stack overflow on bursts.
   */
  private wakeOnComplete = false;

  constructor(protected readonly db: DrizzleDB) {
    // Logger name is the concrete subclass name for precise log attribution.
    this.logger = new Logger(this.constructor.name);
  }

  // ── Abstract interface ────────────────────────────────────────────────────

  /**
   * SELECT a locked batch of pending rows from the outbox table.
   * MUST use the provided transaction and include FOR UPDATE SKIP LOCKED.
   */
  protected abstract fetchBatch(tx: DrizzleTx): Promise<TRow[]>;

  /**
   * Process one row — the domain-specific side effect (send email, fire webhook…).
   *
   * May return a PostCommitTask: a callback that runs AFTER the surrounding DB
   * transaction commits.  Useful for pub/sub publishes that must not fire before
   * the DB write is durable (e.g., Valkey → SSE push for notifications).
   *
   * Return undefined/void when there is no post-commit work.
   */
  protected abstract processRow(row: TRow): Promise<PostCommitTask | void>;

  /** Mark the row as successfully processed (within the relay transaction). */
  protected abstract markSent(tx: DrizzleTx, rowId: string): Promise<void>;

  /**
   * Mark the row as failed or pending-retry (within the relay transaction).
   * newStatus is 'failed' when newAttempts >= maxAttempts, otherwise 'pending'.
   */
  protected abstract markFailed(
    tx: DrizzleTx,
    rowId: string,
    newAttempts: number,
    newStatus: 'pending' | 'failed',
    lastError: string,
  ): Promise<void>;

  // ── Relay loop ────────────────────────────────────────────────────────────

  /**
   * Core relay loop — called by the subclass @Cron handler (and optionally by
   * pub/sub wake signals for near-zero latency dispatch).
   *
   * Subclasses MUST override relay() and add @Cron + @Span decorators for a
   * unique cron name and trace span:
   *
   *   @Cron('*\/5 * * * * *', { name: 'my-relay' })
   *   @Span('my.relay')
   *   override async relay(): Promise<void> { return super.relay(); }
   */
  async relay(): Promise<void> {
    if (this.isRelaying) {
      this.wakeOnComplete = true;
      return;
    }
    this.isRelaying = true;

    const postCommitTasks: PostCommitTask[] = [];

    try {
      await this.db.transaction(async (tx) => {
        const batch = await this.fetchBatch(tx);
        if (!batch.length) return;

        this.logger.debug(`Relaying ${batch.length} row(s)`);

        for (const row of batch) {
          try {
            const task = await this.processRow(row);
            await this.markSent(tx, row.id);
            if (task) postCommitTasks.push(task);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            const newAttempts = row.attempts + 1;
            const newStatus: 'pending' | 'failed' =
              newAttempts >= this.maxAttempts ? 'failed' : 'pending';

            await this.markFailed(tx, row.id, newAttempts, newStatus, errMsg);

            // Only the TERMINAL failure carries DEAD_LETTER_FIELD. A row still inside
            // its retry budget is the retry machinery working as designed; tagging
            // every attempt would make any future alarm fire on transient errors that
            // resolve themselves on the next tick.
            if (newStatus === 'failed') {
              this.logger.error(
                { rowId: row.id, err, [DEAD_LETTER_FIELD]: this.constructor.name },
                `Relay dead-lettered a row after ${newAttempts}/${this.maxAttempts} attempts — it will never be retried`,
              );
            } else {
              this.logger.error(
                { rowId: row.id, err },
                `Relay failed (attempt ${newAttempts}/${this.maxAttempts})`,
              );
            }
          }
        }
      });

      for (const task of postCommitTasks) {
        task().catch((err: unknown) => this.logger.error({ err }, 'Post-commit task failed'));
      }
    } finally {
      this.isRelaying = false;
      if (this.wakeOnComplete) {
        this.wakeOnComplete = false;
        setImmediate(() => {
          void this.relay().catch((err: unknown) =>
            this.logger.error({ err }, 'Post-wake relay failed'),
          );
        });
      }
    }
  }
}
