import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DelegationService, ExclusiveJob } from '@platform';
import { MS_PER_DAY, MS_PER_HOUR } from '@shared-kernel';

/** Expired delegations are retained for this many days for audit purposes before purging. */
const DELEGATION_RETENTION_DAYS = 7;

/** Under the hourly interval, so a crashed pod cannot block the next purge. */
const LOCK_TTL_MS = 55 * 60_000;

/**
 * DelegationExpiryCron — purges expired approval delegation records.
 *
 * Delegations are considered expired once `ends_at` has passed. Expired
 * delegations are already inert at runtime (DelegationService queries filter
 * by `endsAt > now()`), but we clean them up after a 7-day grace window to
 * keep the table compact and maintain a brief audit trail.
 */
@Injectable()
export class DelegationExpiryCron {
  private readonly logger = new Logger(DelegationExpiryCron.name);

  constructor(
    private readonly delegation: DelegationService,
    private readonly exclusive: ExclusiveJob,
  ) {}

  @Interval(MS_PER_HOUR)
  async tick(): Promise<void> {
    await this.exclusive.run('delegation-expiry', LOCK_TTL_MS, async () => {
      // Retain expired delegations for DELEGATION_RETENTION_DAYS after expiry, then purge
      const cutoff = new Date(Date.now() - DELEGATION_RETENTION_DAYS * MS_PER_DAY);
      const deleted = await this.delegation.deleteExpiredBefore(cutoff);
      if (deleted > 0) {
        this.logger.log(`Purged ${deleted} expired approval delegation(s)`);
      }
    });
  }
}
