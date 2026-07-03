import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MS_PER_DAY } from '@shared-kernel';
import { AppConfigService } from '@platform';
import { AUDIT_REPOSITORY, type IAuditRepository } from '../domain/ports/audit.repository';

/**
 * Nightly job that purges audit records beyond the retention window.
 *
 * Retention defaults (configurable via AUDIT_RETENTION_DAYS env var):
 *   - SOC 2 / ISO 27001 baseline: 1 year minimum; 2 years is common practice.
 *   - GDPR: personal data in audit logs of deleted employees should be anonymised
 *     rather than purged (tracked as future work).
 *
 * isRunning guard prevents overlapping runs if a purge takes longer than a day.
 */
@Injectable()
export class AuditCleanupService {
  private readonly logger = new Logger(AuditCleanupService.name);
  private readonly retentionDays: number;
  private isRunning = false;

  constructor(
    @Inject(AUDIT_REPOSITORY) private readonly auditRepo: IAuditRepository,
    private readonly config: AppConfigService,
  ) {
    this.retentionDays = this.config.get('AUDIT_RETENTION_DAYS');
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async purgeExpiredRecords(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Audit cleanup still running from previous tick — skipping');
      return;
    }
    this.isRunning = true;
    try {
      const cutoff = new Date(Date.now() - this.retentionDays * MS_PER_DAY);
      const deleted = await this.auditRepo.deleteOlderThan(cutoff);
      if (deleted > 0) {
        this.logger.log(
          { deleted, cutoffDate: cutoff.toISOString(), retentionDays: this.retentionDays },
          'Audit log cleanup: purged expired records',
        );
      }
    } catch (err) {
      this.logger.error({ err }, 'Audit log cleanup failed');
    } finally {
      this.isRunning = false;
    }
  }
}
