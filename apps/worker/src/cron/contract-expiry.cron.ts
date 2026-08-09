import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ExclusiveJob } from '@platform';
import { ContractsService } from '@modules/contracts';

/**
 * How far ahead HR is warned. 30 days is the default notice period on a contract, so a reminder any
 * later than this arrives after the point at which either side could still give notice.
 */
const REMINDER_WINDOW_DAYS = 30;

/** Under the daily interval, so a crashed pod cannot block tomorrow's sweep. */
const LOCK_TTL_MS = 23 * 60 * 60_000;

/**
 * ContractExpiryCron — moves contracts past their end date to `expired`, and warns about the ones
 * approaching it.
 *
 * WHY A SWEEP AND NOT A COMPUTED STATUS. `status` could be derived on read — "active and end_date <
 * today means expired" — and that was considered. It loses two things a stored status keeps: an
 * audit entry recording WHEN the state changed, and the ability to notify anyone, since a derived
 * value has no moment of transition to hang a notification off. It would also make every query that
 * filters on status carry the date arithmetic, and `uq_employee_active_contract` could not be a
 * partial index on `status` at all — which is the one guarantee this module rests on.
 *
 * DAILY, not hourly: a contract expiring is a date-granular event, and the reminders are
 * deduplicated by idempotency key anyway, so a faster cadence would buy nothing.
 */
@Injectable()
export class ContractExpiryCron {
  private readonly logger = new Logger(ContractExpiryCron.name);

  constructor(
    private readonly contracts: ContractsService,
    private readonly exclusive: ExclusiveJob,
  ) {}

  @Cron('15 1 * * *', { name: 'contract-expiry' })
  async tick(): Promise<void> {
    // ExclusiveJob, because a second replica would otherwise run the same sweep: the transitions are
    // guarded on `status = 'active'` so they cannot double-apply, but the reminders would be
    // enqueued twice with the same key and the log would claim twice the work.
    await this.exclusive.run('contract-expiry', LOCK_TTL_MS, async () => {
      const expired = await this.contracts.expireDueContracts();
      if (expired > 0) this.logger.log(`Expired ${expired} contract(s) past their end date`);

      const reminded = await this.contracts.remindExpiringContracts(REMINDER_WINDOW_DAYS);
      if (reminded > 0) {
        this.logger.log(
          `${reminded} contract(s) end within ${REMINDER_WINDOW_DAYS} days — reminders enqueued`,
        );
      }
    });
  }
}
