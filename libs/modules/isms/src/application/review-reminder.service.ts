import { Inject, Injectable } from '@nestjs/common';
import {
  InjectDrizzle,
  NotificationSchedulerService,
  type DbExecutor,
  type DrizzleDB,
} from '@platform';
import { daysBetween, today } from '@shared-kernel';
import { RISK_REPOSITORY, type IRiskRepository } from '../domain/ports/risk.repository';
import { CONTROL_REPOSITORY, type IControlRepository } from '../domain/ports/control.repository';
import {
  INFORMATION_ASSET_REPOSITORY,
  type IInformationAssetRepository,
} from '../domain/ports/information-asset.repository';
import { VENDOR_REPOSITORY, type IVendorRepository } from '../domain/ports/vendor.repository';

/**
 * How many of each register a single sweep will remind about.
 *
 * A ceiling rather than an unbounded query: the reminder is a nudge, and a backlog of four thousand
 * overdue reviews is a management-review finding, not four thousand notifications. The sweep runs daily, so
 * anything cut off here is picked up tomorrow — and the number of rows CUT OFF is the signal worth having,
 * which is why the caller gets both counts back.
 */
const PER_REGISTER_LIMIT = 500;

/** One register's worth of work, reduced to what the notification needs. */
interface DueReview {
  register: string;
  id: string;
  reference: string;
  name: string;
  dueOn: string;
  ownerId: string | null;
}

export interface ReviewReminderResult {
  /** Reminders enqueued, deduplicated by `idempotencyKey` — a re-run on the same day adds none. */
  reminded: number;
  /** Rows due with NO owner, which cannot be reminded at all. Named because it is a data gap. */
  unowned: number;
}

/**
 * Reminds owners that a periodic review has come due — risks, SoA entries, information assets, suppliers.
 *
 * WHY THIS EXISTS. Four registers carry a `review_due_on`, every screen can filter on it, and every one of
 * those dates passed silently: the column moved into the past and nothing anywhere said so. A review
 * cadence nobody is reminded of is a cadence that exists only in the schema.
 *
 * WHY ONE SERVICE AND NOT FOUR METHODS ON FOUR SERVICES. The four registers differ in exactly two ways —
 * the query that finds due rows, and the words `reference` and `name` map to. Everything else (the
 * template, the idempotency key, the owner-less case, the ceiling) is identical, and four copies of it is
 * four places for the wording and the dedup key to drift apart. Each register contributes a query; this
 * owns the reminder.
 *
 * THE IDEMPOTENCY KEY INCLUDES THE DUE DATE, not the sweep date: re-dating a review to next quarter starts
 * a new reminder, while a review left overdue is reminded once and then stays quiet. Reminding daily about
 * the same untouched row is how people learn to ignore notifications.
 */
@Injectable()
export class ReviewReminderService {
  constructor(
    @Inject(RISK_REPOSITORY) private readonly risks: IRiskRepository,
    @Inject(CONTROL_REPOSITORY) private readonly controls: IControlRepository,
    @Inject(INFORMATION_ASSET_REPOSITORY)
    private readonly assets: IInformationAssetRepository,
    @Inject(VENDOR_REPOSITORY) private readonly vendors: IVendorRepository,
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly notifications: NotificationSchedulerService,
  ) {}

  async remindDueReviews(
    asOf: string = today(),
    limit: number = PER_REGISTER_LIMIT,
  ): Promise<ReviewReminderResult> {
    const due = [
      ...(await this.dueRisks(asOf, limit)),
      ...(await this.dueControls(asOf, limit)),
      ...(await this.dueAssets(asOf, limit)),
      ...(await this.dueVendors(asOf, limit)),
    ];

    let reminded = 0;
    let unowned = 0;

    for (const row of due) {
      // No owner, no recipient. Counted rather than dropped: an information asset or SoA entry with a
      // review date and nobody accountable for it is the gap, and a silent skip hides it.
      if (!row.ownerId) {
        unowned += 1;
        continue;
      }

      await this.db.transaction(async (tx: DbExecutor) => {
        await this.notifications.schedule(tx, {
          type: 'review.due',
          recipientId: row.ownerId!,
          resourceId: row.id,
          vars: {
            register: row.register,
            reference: row.reference,
            name: row.name,
            dueOn: row.dueOn,
            daysOverdue: Math.max(0, daysBetween(row.dueOn, asOf)),
          },
          // The DUE DATE, not `asOf` — see the note on the class.
          idempotencyKey: `review.due:${row.id}:${row.dueOn}`,
        });
      });
      reminded += 1;
    }

    return { reminded, unowned };
  }

  // ── One query per register ───────────────────────────────────────────────────
  //
  // Each reuses the list filter the screens already use, so "overdue" means the same thing in a
  // notification as it does in the register the reader opens afterwards.

  private async dueRisks(asOf: string, limit: number): Promise<DueReview[]> {
    const { rows } = await this.risks.list({ reviewDueOnOrBefore: asOf }, limit, 0);
    return rows.map((risk) => ({
      register: 'Risk',
      id: risk.id,
      reference: risk.reference,
      name: risk.title,
      dueOn: risk.reviewDueOn!,
      ownerId: risk.ownerId,
    }));
  }

  private async dueControls(asOf: string, limit: number): Promise<DueReview[]> {
    const { rows } = await this.controls.listEntries({ reviewDueOnOrBefore: asOf }, limit, 0);
    return rows.map((entry) => ({
      register: 'Control',
      id: entry.id,
      reference: entry.controlReference,
      name: entry.controlTitle,
      dueOn: entry.reviewDueOn!,
      ownerId: entry.ownerId,
    }));
  }

  private async dueAssets(asOf: string, limit: number): Promise<DueReview[]> {
    const { rows } = await this.assets.list({ reviewDueOnOrBefore: asOf }, limit, 0);
    return rows.map((asset) => ({
      register: 'Information asset',
      id: asset.id,
      reference: asset.reference,
      name: asset.name,
      dueOn: asset.reviewDueOn!,
      ownerId: asset.ownerId,
    }));
  }

  /**
   * Suppliers, from the report rather than a list filter.
   *
   * `reviewGaps` is the query the supplier screen already shows, and it answers one thing the others do
   * not: a supplier NEVER assessed has no due date to be past. Those are skipped here — they are the
   * review-gap report's subject, and a reminder saying a review was due on `null` says nothing.
   */
  private async dueVendors(asOf: string, limit: number): Promise<DueReview[]> {
    const gaps = await this.vendors.reviewGaps(limit);
    const owners = new Map<string, string | null>();
    const rows: DueReview[] = [];

    for (const gap of gaps) {
      if (!gap.dueOn || gap.dueOn > asOf) continue;
      if (!owners.has(gap.id)) {
        const vendor = await this.vendors.findById(gap.id);
        owners.set(gap.id, vendor?.ownerId ?? null);
      }
      rows.push({
        register: 'Supplier',
        id: gap.id,
        reference: gap.reference,
        name: gap.name,
        dueOn: gap.dueOn,
        ownerId: owners.get(gap.id) ?? null,
      });
    }

    return rows;
  }
}
