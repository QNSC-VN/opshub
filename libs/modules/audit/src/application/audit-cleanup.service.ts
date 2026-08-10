import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MS_PER_DAY, MS_PER_HOUR } from '@shared-kernel';
import { AppConfigService, ExclusiveJob } from '@platform';
import { AUDIT_REPOSITORY, type IAuditRepository } from '../domain/ports/audit.repository';

/** 23 h — under the daily schedule, so a crashed pod cannot block tomorrow's purge. */
const LOCK_TTL_MS = 23 * MS_PER_HOUR;

/**
 * Nightly job that purges audit records beyond the retention window.
 *
 * Retention defaults (configurable via AUDIT_RETENTION_DAYS env var):
 *   - SOC 2 / ISO 27001 baseline: 1 year minimum; 2 years is common practice.
 *   - GDPR: personal data in audit logs of deleted employees should be anonymised
 *     rather than purged (tracked as future work).
 *
 * Runs through {@link ExclusiveJob}, which supplies both the cross-pod lock and the overlap
 * guard this class used to keep as a private `isRunning` flag — that flag only ever
 * protected a single pod, and this job DELETES rows.
 */
@Injectable()
export class AuditCleanupService {
  private readonly logger = new Logger(AuditCleanupService.name);
  private readonly retentionDays: number;

  constructor(
    @Inject(AUDIT_REPOSITORY) private readonly auditRepo: IAuditRepository,
    private readonly config: AppConfigService,
    private readonly exclusive: ExclusiveJob,
  ) {
    this.retentionDays = this.config.get('AUDIT_RETENTION_DAYS');
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: 'audit-cleanup' })
  async purgeExpiredRecords(): Promise<void> {
    await this.exclusive.run('audit-cleanup', LOCK_TTL_MS, async () => {
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
      }
    });
  }
}
