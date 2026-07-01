import { Module } from '@nestjs/common';
import { GraphSecureScoreService } from './application/graph-secure-score.service';
import { SecurityPostureSyncCron } from './application/security-posture-sync.cron';
import { SecurityPostureController } from './interface/http/security-posture.controller';

@Module({
  controllers: [SecurityPostureController],
  providers: [GraphSecureScoreService, SecurityPostureSyncCron],
  exports: [GraphSecureScoreService],
})
export class SecurityPostureModule {}
