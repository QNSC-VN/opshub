import { Module } from '@nestjs/common';
import { GraphSecureScoreService } from './application/graph-secure-score.service';
import { SecurityPostureController } from './interface/http/security-posture.controller';

@Module({
  controllers: [SecurityPostureController],
  providers: [GraphSecureScoreService],
  exports: [GraphSecureScoreService],
})
export class SecurityPostureModule {}
