import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewReminderService } from './review-reminder.service';

/**
 * The review-due sweep.
 *
 * WHAT IS WORTH ASSERTING HERE, given the queries themselves are the repositories' job:
 *   - every register contributes, because the failure mode of a four-register sweep is one register
 *     silently dropping out of it
 *   - the idempotency key is keyed on the DUE DATE, which is what makes a row left overdue quiet after the
 *     first reminder instead of nagging every morning
 *   - a row with no owner is COUNTED rather than skipped, because that is a data gap nobody else reports
 *   - a supplier never assessed is left to the review-gap report: there is no due date to be past
 */

const TX = { tx: true };

function build(
  over: {
    risks?: unknown[];
    controls?: unknown[];
    assets?: unknown[];
    gaps?: unknown[];
    vendorOwner?: string | null;
  } = {},
) {
  const risks = { list: vi.fn().mockResolvedValue({ rows: over.risks ?? [], total: 0 }) };
  const controls = {
    listEntries: vi.fn().mockResolvedValue({ rows: over.controls ?? [], total: 0 }),
  };
  const assets = { list: vi.fn().mockResolvedValue({ rows: over.assets ?? [], total: 0 }) };
  const vendors = {
    reviewGaps: vi.fn().mockResolvedValue(over.gaps ?? []),
    findById: vi
      .fn()
      .mockResolvedValue(
        over.vendorOwner === undefined ? { ownerId: 'owner-v' } : { ownerId: over.vendorOwner },
      ),
  };
  const db = { transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(TX)) };
  const notifications = { schedule: vi.fn().mockResolvedValue(undefined) };

  const service = new ReviewReminderService(
    risks as never,
    controls as never,
    assets as never,
    vendors as never,
    db as never,
    notifications as never,
  );

  return { service, risks, controls, assets, vendors, notifications };
}

const RISK = {
  id: 'risk-1',
  reference: 'R-001',
  title: 'Unpatched edge devices',
  ownerId: 'owner-r',
  reviewDueOn: '2026-08-01',
};
const SOA = {
  id: 'soa-1',
  controlReference: 'A.5.1',
  controlTitle: 'Policies for information security',
  ownerId: 'owner-c',
  reviewDueOn: '2026-07-15',
};
const ASSET = {
  id: 'asset-1',
  reference: 'IA-004',
  name: 'Customer billing extract',
  ownerId: 'owner-a',
  reviewDueOn: '2026-08-10',
};

describe('ReviewReminderService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reminds the owner of every register, and asks each with the same as-of date', async () => {
    const { service, risks, controls, assets, vendors, notifications } = build({
      risks: [RISK],
      controls: [SOA],
      assets: [ASSET],
      gaps: [{ id: 'vendor-1', reference: 'SUP-002', name: 'Acme Hosting', dueOn: '2026-08-05' }],
    });

    const result = await service.remindDueReviews('2026-08-12');

    expect(result).toEqual({ reminded: 4, unowned: 0 });
    // Every register asked, and asked about the same day: a sweep where one register uses a different
    // notion of "due" reports a date the reader's screen disagrees with.
    expect(risks.list).toHaveBeenCalledWith({ reviewDueOnOrBefore: '2026-08-12' }, 500, 0);
    expect(controls.listEntries).toHaveBeenCalledWith(
      { reviewDueOnOrBefore: '2026-08-12' },
      500,
      0,
    );
    expect(assets.list).toHaveBeenCalledWith({ reviewDueOnOrBefore: '2026-08-12' }, 500, 0);
    expect(vendors.reviewGaps).toHaveBeenCalledWith(500);

    const registers = notifications.schedule.mock.calls.map(
      ([, input]) => (input as { vars: { register: string } }).vars.register,
    );
    expect(registers).toEqual(['Risk', 'Control', 'Information asset', 'Supplier']);
  });

  it('keys the reminder on the DUE DATE, so an untouched overdue row is reminded once', async () => {
    const { service, notifications } = build({ risks: [RISK] });

    // Two sweeps on different days: same key both times, so the outbox insert dedups the second.
    await service.remindDueReviews('2026-08-12');
    await service.remindDueReviews('2026-08-13');

    const keys = notifications.schedule.mock.calls.map(
      ([, input]) => (input as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys).toEqual(['review.due:risk-1:2026-08-01', 'review.due:risk-1:2026-08-01']);
  });

  it('counts the days overdue from the due date, and never reports a negative', async () => {
    const { service, notifications } = build({
      risks: [RISK, { ...RISK, id: 'risk-2', reviewDueOn: '2026-08-12' }],
    });

    await service.remindDueReviews('2026-08-12');

    const overdue = notifications.schedule.mock.calls.map(
      ([, input]) => (input as { vars: { daysOverdue: number } }).vars.daysOverdue,
    );
    // 11 days for the first; the second is due TODAY, which is 0 rather than a negative number.
    expect(overdue).toEqual([11, 0]);
  });

  it('counts a due row with no owner instead of silently dropping it', async () => {
    const { service, notifications } = build({
      controls: [{ ...SOA, ownerId: null }],
    });

    const result = await service.remindDueReviews('2026-08-12');

    // The gap is the point: an SoA entry with a review date and nobody accountable is unreviewable.
    expect(result).toEqual({ reminded: 0, unowned: 1 });
    expect(notifications.schedule).not.toHaveBeenCalled();
  });

  it('leaves a supplier that was never assessed to the review-gap report', async () => {
    const { service, notifications } = build({
      // `dueOn: null` is the never-assessed case, and `2026-09-01` is simply not due yet.
      gaps: [
        { id: 'vendor-1', reference: 'SUP-002', name: 'Acme', dueOn: null },
        { id: 'vendor-2', reference: 'SUP-003', name: 'Globex', dueOn: '2026-09-01' },
      ],
    });

    const result = await service.remindDueReviews('2026-08-12');

    expect(result).toEqual({ reminded: 0, unowned: 0 });
    expect(notifications.schedule).not.toHaveBeenCalled();
  });

  it('writes each reminder inside a transaction', async () => {
    const { service, notifications } = build({ assets: [ASSET] });

    await service.remindDueReviews('2026-08-12');

    expect(notifications.schedule).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        type: 'review.due',
        recipientId: 'owner-a',
        resourceId: 'asset-1',
      }),
    );
  });
});
