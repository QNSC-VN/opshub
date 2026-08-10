import { Module } from '@nestjs/common';
import { AuditModule } from '@modules/audit';
import { IdentityModule } from '@modules/identity';
import { NonconformanceService } from './application/nonconformance.service';
import { CapaService } from './application/capa.service';
import { InternalAuditService } from './application/internal-audit.service';
import { NonconformanceController } from './interface/http/nonconformance.controller';
import { CapaController } from './interface/http/capa.controller';
import { InternalAuditController } from './interface/http/internal-audit.controller';
import { NonconformanceDrizzleRepository } from './infrastructure/persistence/nonconformance.drizzle-repository';
import { CapaDrizzleRepository } from './infrastructure/persistence/capa.drizzle-repository';
import { InternalAuditDrizzleRepository } from './infrastructure/persistence/internal-audit.drizzle-repository';
import {
  CAPA_REPOSITORY,
  INTERNAL_AUDIT_REPOSITORY,
  NONCONFORMANCE_REPOSITORY,
} from './domain/ports/qms.repository';

@Module({
  // IdentityModule for EmployeeService: the controllers check an owner exists before writing, since
  // `owner_id` carries no cross-schema FK.
  //
  // The two services depend on each other's REPOSITORIES, not on each other — the closure gate reads
  // CAPA rows and the CAPA service reads the finding. That keeps the graph acyclic, so neither needs
  // a `forwardRef`, and it means neither service can quietly reach past the other's guards.
  imports: [AuditModule, IdentityModule],
  controllers: [NonconformanceController, CapaController, InternalAuditController],
  providers: [
    NonconformanceService,
    CapaService,
    InternalAuditService,
    { provide: NONCONFORMANCE_REPOSITORY, useClass: NonconformanceDrizzleRepository },
    { provide: CAPA_REPOSITORY, useClass: CapaDrizzleRepository },
    { provide: INTERNAL_AUDIT_REPOSITORY, useClass: InternalAuditDrizzleRepository },
  ],
  exports: [NonconformanceService, CapaService, InternalAuditService],
})
export class QmsModule {}
