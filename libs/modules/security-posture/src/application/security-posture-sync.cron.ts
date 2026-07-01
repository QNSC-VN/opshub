import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GraphSecureScoreService } from './graph-secure-score.service';

@Injectable()
export class SecurityPostureSyncCron {
  private readonly logger = new Logger(SecurityPostureSyncCron.name);

  constructor(private readonly scoreService: GraphSecureScoreService) {}

  /** Daily sync at 02:00 UTC — Secure Score data typically refreshes once per day. */
  @Cron('0 2 * * *')
  async syncSecurityPosture(): Promise<void> {
    if (!this.scoreService.isEnabled()) {
      this.logger.debug('Graph credentials not configured — security posture sync skipped');
      return;
    }

    this.logger.log('Starting security posture sync...');
    try {
      const score = await this.scoreService.syncSecureScore();
      if (score) {
        this.logger.log(`Secure Score: ${score.score}/${score.maxScore} (${score.percentage.toFixed(1)}%)`);
      }
      const controls = await this.scoreService.syncBaselineChecks();
      this.logger.log(`Security posture sync done — ${controls} baseline controls updated`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Security posture sync failed: ${msg}`);
    }
  }
}
