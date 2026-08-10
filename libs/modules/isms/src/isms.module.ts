import { Module } from '@nestjs/common';
import { AuditModule } from '@modules/audit';
import { IdentityModule } from '@modules/identity';
import { RiskService } from './application/risk.service';
import { ControlService } from './application/control.service';
import { IncidentService } from './application/incident.service';
import { InformationAssetService } from './application/information-asset.service';
import { RiskAcceptanceTypeDef } from './application/risk-acceptance.type-def';
import { RiskController } from './interface/http/risk.controller';
import { ControlController, RiskControlController } from './interface/http/control.controller';
import { IncidentController } from './interface/http/incident.controller';
import { InformationAssetController } from './interface/http/information-asset.controller';
import { RiskDrizzleRepository } from './infrastructure/persistence/risk.drizzle-repository';
import { ControlDrizzleRepository } from './infrastructure/persistence/control.drizzle-repository';
import { IncidentDrizzleRepository } from './infrastructure/persistence/incident.drizzle-repository';
import { InformationAssetDrizzleRepository } from './infrastructure/persistence/information-asset.drizzle-repository';
import { RISK_REPOSITORY } from './domain/ports/risk.repository';
import { CONTROL_REPOSITORY } from './domain/ports/control.repository';
import { INCIDENT_REPOSITORY } from './domain/ports/incident.repository';
import { INFORMATION_ASSET_REPOSITORY } from './domain/ports/information-asset.repository';

@Module({
  // IdentityModule for EmployeeService: the controller checks an owner exists before writing, since
  // `owner_id` carries no cross-schema FK. `RequestEngine` needs no import — PlatformModule is
  // global, which is also what lets the type-def register itself on boot.
  imports: [AuditModule, IdentityModule],
  controllers: [
    RiskController,
    ControlController,
    RiskControlController,
    IncidentController,
    InformationAssetController,
  ],
  providers: [
    RiskService,
    ControlService,
    IncidentService,
    InformationAssetService,
    // The service submits the acceptance request and this definition calls back to apply the
    // outcome, so the pair is circular by construction. The `forwardRef` that resolves it lives on
    // the type-def's constructor, where the cycle actually is; the alternative — a second copy of
    // the acceptance write — is how the two paths drift on which columns acceptance sets.
    RiskAcceptanceTypeDef,
    { provide: RISK_REPOSITORY, useClass: RiskDrizzleRepository },
    { provide: CONTROL_REPOSITORY, useClass: ControlDrizzleRepository },
    { provide: INCIDENT_REPOSITORY, useClass: IncidentDrizzleRepository },
    { provide: INFORMATION_ASSET_REPOSITORY, useClass: InformationAssetDrizzleRepository },
  ],
  exports: [RiskService, ControlService, IncidentService, InformationAssetService],
})
export class IsmsModule {}
