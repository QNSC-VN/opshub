import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GraphSyncService } from './graph-sync.service';
import { ShadowItDetectionService } from './shadow-it-detection.service';

@Injectable()
export class ComplianceSyncCron {
  private readonly logger = new Logger(ComplianceSyncCron.name);

  constructor(
    private readonly graphSync: GraphSyncService,
    private readonly shadowIt: ShadowItDetectionService,
  ) {}

  /** Device compliance sync every 30 minutes. */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async syncDeviceCompliance(): Promise<void> {
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
  }

  /** Shadow IT detection every 6 hours. */
  @Cron('0 */6 * * *')
  async detectShadowIt(): Promise<void> {
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
  }
}
