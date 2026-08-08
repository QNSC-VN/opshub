import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ExclusiveJob } from '@platform';
import { GraphSecureScoreService } from './graph-secure-score.service';

/** 23 h — under the daily schedule, so a crashed pod cannot block tomorrow's run. */
const LOCK_TTL_MS = 23 * 60 * 60_000;

@Injectable()
export class SecurityPostureSyncCron {
  private readonly logger = new Logger(SecurityPostureSyncCron.name);

  constructor(
    private readonly scoreService: GraphSecureScoreService,
    private readonly exclusive: ExclusiveJob,
  ) {}

  /** Daily sync at 02:00 UTC — Secure Score data typically refreshes once per day. */
  @Cron('0 2 * * *', { name: 'security-posture-sync' })
  async syncSecurityPosture(): Promise<void> {
    await this.exclusive.run('security-posture-sync', LOCK_TTL_MS, async () => {
      if (!this.scoreService.isEnabled()) {
        this.logger.debug('Graph credentials not configured — security posture sync skipped');
        return;
      }

      this.logger.log('Starting security posture sync...');
      try {
        const score = await this.scoreService.syncSecureScore();
        if (score) {
          this.logger.log(
            `Secure Score: ${score.score}/${score.maxScore} (${score.percentage.toFixed(1)}%)`,
          );
        }
        const controls = await this.scoreService.syncBaselineChecks();
        this.logger.log(`Security posture sync done — ${controls} baseline controls updated`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Security posture sync failed: ${msg}`);
      }
    });
  }
}
