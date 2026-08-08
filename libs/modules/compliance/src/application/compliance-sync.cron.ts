import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ExclusiveJob } from '@platform';
import { GraphSyncService } from './graph-sync.service';
import { ShadowItDetectionService } from './shadow-it-detection.service';

/** Lock TTL sits just under each schedule so a crashed pod never blocks the next tick. */
const DEVICE_SYNC_LOCK_TTL_MS = 25 * 60_000;
const SHADOW_IT_LOCK_TTL_MS = 5 * 60 * 60_000;

@Injectable()
export class ComplianceSyncCron {
  private readonly logger = new Logger(ComplianceSyncCron.name);

  constructor(
    private readonly graphSync: GraphSyncService,
    private readonly shadowIt: ShadowItDetectionService,
    private readonly exclusive: ExclusiveJob,
  ) {}

  /** Device compliance sync every 30 minutes. */
  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'compliance-device-sync' })
  async syncDeviceCompliance(): Promise<void> {
    await this.exclusive.run('compliance-device-sync', DEVICE_SYNC_LOCK_TTL_MS, async () => {
      if (!this.graphSync.isEnabled()) {
        this.logger.debug('Graph credentials not configured — compliance sync skipped');
        return;
      }

      this.logger.log('Starting device compliance sync from Intune...');
      try {
        const result = await this.graphSync.syncDevices();
        this.logger.log(
          `Compliance sync done — ${result.devices} devices processed, ${result.findings} new findings`,
        );
      } catch (err: unknown) {
        this.logger.error(`Compliance sync failed: ${String(err)}`);
      }
    });
  }

  /** Shadow IT detection every 6 hours. */
  @Cron('0 */6 * * *', { name: 'compliance-shadow-it' })
  async detectShadowIt(): Promise<void> {
    await this.exclusive.run('compliance-shadow-it', SHADOW_IT_LOCK_TTL_MS, async () => {
      if (!this.shadowIt.isEnabled()) return;

      this.logger.log('Starting Shadow IT detection scan...');
      try {
        const result = await this.shadowIt.detectShadowIt();
        this.logger.log(
          `Shadow IT scan done — ${result.scanned} apps scanned, ${result.newFindings} new findings`,
        );
      } catch (err: unknown) {
        this.logger.error(`Shadow IT detection failed: ${String(err)}`);
      }
    });
  }
}
