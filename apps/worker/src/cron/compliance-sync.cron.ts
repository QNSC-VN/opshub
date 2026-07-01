import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

/**
 * Compliance sync — placeholder for the scheduled job that pulls device
 * software inventory from the MDM/EDR (e.g. Intune / Defender via MS Graph
 * delta queries) and raises `compliance_findings` for non-whitelisted apps.
 *
 * Wire the Graph client + finding ingestion here once credentials are provisioned.
 */
@Injectable()
export class ComplianceSyncCron {
  private readonly logger = new Logger(ComplianceSyncCron.name);

  @Cron(CronExpression.EVERY_HOUR)
  // eslint-disable-next-line @typescript-eslint/require-await
  async sync(): Promise<void> {
    this.logger.log('Compliance sync tick (stub) — Graph delta ingestion not yet wired');
  }
}
