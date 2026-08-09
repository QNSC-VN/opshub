import { Module } from '@nestjs/common';
import { AuditModule } from '@modules/audit';
import { IdentityModule } from '@modules/identity';
import { ContractsService } from './application/contracts.service';
import { ContractsController } from './interface/http/contracts.controller';
import { ContractsDrizzleRepository } from './infrastructure/persistence/contracts.drizzle-repository';
import { CONTRACTS_REPOSITORY } from './domain/ports/contracts.repository';

@Module({
  // IdentityModule for EmployeeService: the controller checks an employee exists before drafting a
  // contract for them, and the sweep resolves display names for its notifications, since
  // `employee_id` carries no cross-schema FK.
  imports: [AuditModule, IdentityModule],
  controllers: [ContractsController],
  providers: [
    ContractsService,
    { provide: CONTRACTS_REPOSITORY, useClass: ContractsDrizzleRepository },
  ],
  // Exported for the worker's expiry sweep.
  exports: [ContractsService],
})
export class ContractsModule {}
