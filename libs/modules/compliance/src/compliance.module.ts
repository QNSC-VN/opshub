import { Module } from '@nestjs/common';
import { AuditModule } from '@modules/audit';
import { ComplianceService } from './application/compliance.service';
import { GraphSyncService } from './application/graph-sync.service';
import { ShadowItDetectionService } from './application/shadow-it-detection.service';
import { ComplianceController } from './interface/http/compliance.controller';
import { ComplianceDrizzleRepository } from './infrastructure/persistence/compliance.drizzle-repository';
import { COMPLIANCE_REPOSITORY } from './domain/ports/compliance.repository';

@Module({
  imports: [AuditModule],
  controllers: [ComplianceController],
  providers: [
    ComplianceService,
    GraphSyncService,
    ShadowItDetectionService,
    { provide: COMPLIANCE_REPOSITORY, useClass: ComplianceDrizzleRepository },
  ],
  exports: [ComplianceService, GraphSyncService, ShadowItDetectionService],
})
export class ComplianceModule {}
