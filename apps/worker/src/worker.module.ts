import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { PlatformModule, AppConfigService } from '@platform';
import { ComplianceModule, ComplianceSyncCron } from '@modules/compliance';
import { SecurityPostureModule, SecurityPostureSyncCron } from '@modules/security-posture';
import { OutboxRelayService } from './outbox/outbox-relay.service';
import { RequestExpiryCron } from './cron/request-expiry.cron';
import { SlaBreachCron } from './cron/sla-breach.cron';
import { DelegationExpiryCron } from './cron/delegation-expiry.cron';
import { StorageCleanupCron } from './cron/storage-cleanup.cron';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL'),
          transport: config.get('LOG_PRETTY')
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        },
      }),
    }),
    ScheduleModule.forRoot(),
    PlatformModule,
    ComplianceModule,
    SecurityPostureModule,
  ],
  providers: [
    OutboxRelayService,
    ComplianceSyncCron,
    SecurityPostureSyncCron,
    RequestExpiryCron,
    SlaBreachCron,
    DelegationExpiryCron,
    StorageCleanupCron,
  ],
})
export class WorkerModule {}
