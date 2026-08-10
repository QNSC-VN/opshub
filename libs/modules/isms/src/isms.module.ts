import { Module } from '@nestjs/common';
import { AuditModule } from '@modules/audit';
import { IdentityModule } from '@modules/identity';
import { RiskService } from './application/risk.service';
import { RiskAcceptanceTypeDef } from './application/risk-acceptance.type-def';
import { RiskController } from './interface/http/risk.controller';
import { RiskDrizzleRepository } from './infrastructure/persistence/risk.drizzle-repository';
import { RISK_REPOSITORY } from './domain/ports/risk.repository';

@Module({
  // IdentityModule for EmployeeService: the controller checks an owner exists before writing, since
  // `owner_id` carries no cross-schema FK. `RequestEngine` needs no import — PlatformModule is
  // global, which is also what lets the type-def register itself on boot.
  imports: [AuditModule, IdentityModule],
  controllers: [RiskController],
  providers: [
    RiskService,
    // The service submits the acceptance request and this definition calls back to apply the
    // outcome, so the pair is circular by construction. The `forwardRef` that resolves it lives on
    // the type-def's constructor, where the cycle actually is; the alternative — a second copy of
    // the acceptance write — is how the two paths drift on which columns acceptance sets.
    RiskAcceptanceTypeDef,
    { provide: RISK_REPOSITORY, useClass: RiskDrizzleRepository },
  ],
  exports: [RiskService],
})
export class IsmsModule {}
