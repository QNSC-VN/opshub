import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DelegationService } from '@platform';
import { MS_PER_DAY } from '@shared-kernel';

/** Expired delegations are retained for this many days for audit purposes before purging. */
const DELEGATION_RETENTION_DAYS = 7;

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

  constructor(private readonly delegation: DelegationService) {}

  @Interval(60 * 60_000) // hourly
  async tick(): Promise<void> {
    // Retain expired delegations for DELEGATION_RETENTION_DAYS after expiry, then purge
    const cutoff = new Date(Date.now() - DELEGATION_RETENTION_DAYS * MS_PER_DAY);
    const deleted = await this.delegation.deleteExpiredBefore(cutoff);
    if (deleted > 0) {
      this.logger.log(`Purged ${deleted} expired approval delegation(s)`);
    }
  }
}
