import { Module } from '@nestjs/common';
import { AuditService } from './application/audit.service';
import { AuditCleanupService } from './application/audit-cleanup.service';
import { AuditController } from './interface/http/audit.controller';
import { AuditDrizzleRepository } from './infrastructure/persistence/audit.drizzle-repository';
import { AUDIT_REPOSITORY } from './domain/ports/audit.repository';

@Module({
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditCleanupService,
    { provide: AUDIT_REPOSITORY, useClass: AuditDrizzleRepository },
  ],
  exports: [AuditService],
})
export class AuditModule {}
