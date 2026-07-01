import { Module } from '@nestjs/common';
import { AuditModule } from '@modules/audit';
import { IdentityModule } from '@modules/identity';
import { WorkforceService } from './application/workforce.service';
import { GraphProvisioningService } from './application/graph-provisioning.service';
import { LeaveRequestTypeDef } from './application/leave-request.type-def';
import { OvertimeTypeDef } from './application/overtime.type-def';
import { OnboardingTypeDef } from './application/onboarding.type-def';
import { OffboardingTypeDef } from './application/offboarding.type-def';
import { WorkforceController } from './interface/http/workforce.controller';
import { WorkforceDrizzleRepository } from './infrastructure/persistence/workforce.drizzle-repository';
import { WORKFORCE_REPOSITORY } from './domain/ports/workforce.repository';

@Module({
  imports: [AuditModule, IdentityModule],
  controllers: [WorkforceController],
  providers: [
    WorkforceService,
    GraphProvisioningService,
    LeaveRequestTypeDef,
    OvertimeTypeDef,
    OnboardingTypeDef,
    OffboardingTypeDef,
    { provide: WORKFORCE_REPOSITORY, useClass: WorkforceDrizzleRepository },
  ],
  exports: [WorkforceService, GraphProvisioningService],
})
export class WorkforceModule {}
