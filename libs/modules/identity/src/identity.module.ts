import { Module } from '@nestjs/common';
import { AuditModule } from '@modules/audit';
import { AuthzModule } from '@modules/authz';
import { EmployeeService } from './application/employee.service';
import { AuthService } from './application/auth.service';
import { EmployeesController } from './interface/http/employees.controller';
import { AuthController } from './interface/http/auth.controller';
import { EmployeeDrizzleRepository } from './infrastructure/persistence/employee.drizzle-repository';
import { RefreshTokenDrizzleRepository } from './infrastructure/persistence/refresh-token.drizzle-repository';
import { EMPLOYEE_REPOSITORY } from './domain/ports/employee.repository';
import { REFRESH_TOKEN_REPOSITORY } from './domain/ports/refresh-token.repository';

@Module({
  imports: [AuditModule, AuthzModule],
  controllers: [EmployeesController, AuthController],
  providers: [
    EmployeeService,
    AuthService,
    { provide: EMPLOYEE_REPOSITORY, useClass: EmployeeDrizzleRepository },
    { provide: REFRESH_TOKEN_REPOSITORY, useClass: RefreshTokenDrizzleRepository },
  ],
  exports: [EmployeeService],
})
export class IdentityModule {}
