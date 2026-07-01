import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  Auth,
  RequirePermission,
  ApiCommonErrors,
  ApiPagedResponse,
  CurrentUser,
  buildPageResult,
  RateLimit,
} from '@platform';
import type { JwtPayload, PagedResult } from '@platform';
import { AuditService } from '@modules/audit';
import { EmployeeService } from '../../application/employee.service';
import {
  CreateEmployeeDto,
  ListEmployeesQueryDto,
  UpdateEmployeeDto,
  UpdateStatusDto,
  EmployeeResponseDto,
  PresignAvatarDto,
  ConfirmAvatarDto,
} from './dto/employee.dto';
import type { Employee } from '../../domain/employee.types';

function toDto(e: Employee): EmployeeResponseDto {
  return {
    id: e.id,
    email: e.email,
    displayName: e.displayName,
    department: e.department,
    jobTitle: e.jobTitle,
    managerId: e.managerId,
    roles: e.roles,
    status: e.status,
    photoStorageKey: e.photoStorageKey,
    createdAt: e.createdAt.toISOString(),
  };
}

@ApiTags('employees')
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly employeeService: EmployeeService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Auth()
  @RateLimit('STRICT')
  @ApiOperation({ summary: 'List employees' })
  @ApiPagedResponse(EmployeeResponseDto)
  @ApiCommonErrors(401)
  async list(@Query() query: ListEmployeesQueryDto): Promise<PagedResult<EmployeeResponseDto>> {
    const { rows, total } = await this.employeeService.list(
      { status: query.status, department: query.department, search: query.search },
      query.limit,
      query.offset,
    );
    return buildPageResult(rows.map(toDto), total, query.limit, query.offset);
  }

  @Get(':id')
  @Auth()
  @ApiOperation({ summary: 'Get an employee by id' })
  @ApiOkResponse({ type: EmployeeResponseDto })
  @ApiCommonErrors(401, 404)
  async getById(@Param('id') id: string): Promise<EmployeeResponseDto> {
    return toDto(await this.employeeService.getById(id));
  }

  @Post()
  @RequirePermission('employee.write')
  @ApiOperation({ summary: 'Create an employee record' })
  @ApiCreatedResponse({ type: EmployeeResponseDto })
  @ApiCommonErrors(401, 403, 409, 422)
  async create(
    @Body() dto: CreateEmployeeDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<EmployeeResponseDto> {
    const employee = await this.employeeService.create(dto, { sub: user.sub, email: user.email });
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: 'employee.created',
      resourceType: 'employee',
      resourceId: employee.id,
      metadata: { email: employee.email, department: employee.department },
    });
    return toDto(employee);
  }

  @Patch(':id')
  @RequirePermission('employee.write')
  @ApiOperation({
    summary: 'Update employee profile fields (display name, department, job title, roles)',
  })
  @ApiOkResponse({ type: EmployeeResponseDto })
  @ApiCommonErrors(401, 403, 404, 422)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<EmployeeResponseDto> {
    const employee = await this.employeeService.update(id, dto, {
      sub: user.sub,
      email: user.email,
    });
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: 'employee.updated',
      resourceType: 'employee',
      resourceId: id,
      metadata: { changes: dto },
    });
    return toDto(employee);
  }

  @Patch(':id/status')
  @RequirePermission('employee.write')
  @ApiOperation({
    summary: 'Change employee status — offboarding immediately revokes all active sessions',
  })
  @ApiOkResponse({ type: EmployeeResponseDto })
  @ApiCommonErrors(401, 403, 404, 422)
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<EmployeeResponseDto> {
    const employee = await this.employeeService.updateStatus(id, dto.status, {
      sub: user.sub,
      email: user.email,
    });
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: 'employee.status_changed',
      resourceType: 'employee',
      resourceId: id,
      metadata: { status: dto.status },
    });
    return toDto(employee);
  }

  // ── Avatar ──────────────────────────────────────────────────────────────────

  @Post(':id/avatar/presign')
  @Auth()
  @ApiOperation({ summary: 'Get a presigned S3 PUT URL to upload an employee avatar' })
  @ApiOkResponse({
    schema: {
      properties: {
        fileId: { type: 'string' },
        uploadUrl: { type: 'string' },
        key: { type: 'string' },
      },
      required: ['fileId', 'uploadUrl', 'key'],
    },
  })
  @ApiCommonErrors(401, 403, 404, 422)
  async presignAvatar(
    @Param('id') id: string,
    @Body() dto: PresignAvatarDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.employeeService.presignAvatar(id, dto, { sub: user.sub, email: user.email });
  }

  @Post(':id/avatar/confirm')
  @Auth()
  @ApiOperation({ summary: 'Confirm avatar upload completed — links the photo to the employee' })
  @ApiOkResponse({
    schema: { properties: { avatarUrl: { type: 'string' } }, required: ['avatarUrl'] },
  })
  @ApiCommonErrors(401, 403, 404, 422)
  async confirmAvatar(
    @Param('id') id: string,
    @Body() dto: ConfirmAvatarDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.employeeService.confirmAvatar(id, dto.fileId, { sub: user.sub, email: user.email });
  }

  @Get(':id/avatar')
  @Auth()
  @ApiOperation({ summary: 'Get a time-limited download URL for the employee avatar' })
  @ApiOkResponse({
    schema: {
      properties: { avatarUrl: { type: 'string', nullable: true } },
      required: ['avatarUrl'],
    },
  })
  @ApiCommonErrors(401, 404)
  async getAvatarUrl(@Param('id') id: string) {
    return this.employeeService.getAvatarUrl(id);
  }

  @Delete(':id/avatar')
  @RequirePermission('employee.write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete the employee avatar' })
  @ApiNoContentResponse()
  @ApiCommonErrors(401, 403, 404)
  async deleteAvatar(@Param('id') id: string, @CurrentUser() user: JwtPayload): Promise<void> {
    await this.employeeService.deleteAvatar(id, { sub: user.sub, email: user.email });
  }
}
