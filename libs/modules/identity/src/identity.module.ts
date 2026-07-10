import { Module } from '@nestjs/common';
import { AuditModule } from '@modules/audit';
import { AuthzModule } from '@modules/authz';
import { EmployeeService } from './application/employee.service';
import { EmployeesController } from './interface/http/employees.controller';
import { AuthController } from './interface/http/auth.controller';
import { EmployeeDrizzleRepository } from './infrastructure/persistence/employee.drizzle-repository';
import { RefreshTokenDrizzleRepository } from './infrastructure/persistence/refresh-token.drizzle-repository';
import { EMPLOYEE_REPOSITORY } from './domain/ports/employee.repository';
import { REFRESH_TOKEN_REPOSITORY } from './domain/ports/refresh-token.repository';
import { sharedAuthProviders } from './infrastructure/shared-auth/shared-auth.providers';

/**
 * Identity module — employee directory + authentication.
 *
 * Authentication is delegated to the shared `@qnsc-vn/identity` AuthService,
 * wired to opshub's concrete adapters via {@link sharedAuthProviders}. opshub
 * keeps its own `AuthController` (cookie shape + `/me` permission resolution)
 * and its own JWT strategy/guards; only the auth *service* is shared.
 */
@Module({
  imports: [AuditModule, AuthzModule],
  controllers: [EmployeesController, AuthController],
  providers: [
    EmployeeService,
    { provide: EMPLOYEE_REPOSITORY, useClass: EmployeeDrizzleRepository },
    // Retained for employee offboarding (EmployeeService revokes all outstanding
    // refresh tokens); the shared AuthService uses its own AUTH_SESSION_REPOSITORY
    // binding over the same table.
    { provide: REFRESH_TOKEN_REPOSITORY, useClass: RefreshTokenDrizzleRepository },
    ...sharedAuthProviders,
  ],
  exports: [EmployeeService],
})
export class IdentityModule {}
