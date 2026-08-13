import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ExclusiveJob } from '@platform';
import { ReviewReminderService } from '@modules/isms';
import { MS_PER_HOUR } from '@shared-kernel';

/** Under the daily interval, so a crashed pod cannot block tomorrow's sweep. */
const LOCK_TTL_MS = 23 * MS_PER_HOUR;

/**
 * ReviewDueCron — tells owners that a periodic review has come due.
 *
 * WHY THIS EXISTS. Four ISMS registers carry a `review_due_on` and every screen can filter on it, but the
 * dates passed silently: the column moved into the past and nothing anywhere said so. ISO 27001 §9.3 and
 * §8.1 both rest on those cadences actually happening, and a cadence nobody is reminded of is one that
 * exists only in the schema.
 *
 * DAILY, at 01:40. A review coming due is a date-granular event, so a faster cadence buys nothing — and the
 * reminders are keyed on the row's DUE DATE, so a row left overdue is reminded once rather than every
 * morning until somebody gives up on notifications altogether.
 *
 * 01:40 sits after the contract sweep at 01:15 rather than alongside it: both write notifications, and
 * spreading them keeps one slow sweep from delaying the other's lock.
 */
@Injectable()
export class ReviewDueCron {
  private readonly logger = new Logger(ReviewDueCron.name);

  constructor(
    private readonly reviews: ReviewReminderService,
    private readonly exclusive: ExclusiveJob,
  ) {}

  @Cron('40 1 * * *', { name: 'review-due' })
  async tick(): Promise<void> {
    // ExclusiveJob, because `@Cron` fires on every replica: the reminders are deduplicated by
    // idempotency key so a second run cannot double-notify, but it would double the queries and the log
    // would claim twice the work.
    await this.exclusive.run('review-due', LOCK_TTL_MS, async () => {
      const { reminded, unowned } = await this.reviews.remindDueReviews();

      if (reminded > 0) this.logger.log(`${reminded} review(s) due — reminders enqueued`);
      // WARN, not debug: a register row with a review date and no owner cannot be reminded at all, so
      // this count is the one thing the sweep finds that nobody else is looking for.
      if (unowned > 0) {
        this.logger.warn(
          `${unowned} due review(s) have no owner, so nobody was reminded about them`,
        );
      }
    });
  }
}
