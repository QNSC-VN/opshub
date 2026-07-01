import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiCommonErrors, CurrentUser, RequirePermission } from '@platform';
import type { JwtPayload, Permission, RoleAssignment, RoleWithPermissions } from '@platform';
import { DelegationService, type ApprovalDelegation } from '@platform';
import { AuditService } from '@modules/audit';
import { AuthzAdminService } from '../../application/authz-admin.service';
import {
  AssignRoleDto,
  CreateDelegationDto,
  CreateRoleDto,
  DelegationResponseDto,
  ListDelegationsQueryDto,
  PermissionResponseDto,
  RoleAssignmentResponseDto,
  RoleResponseDto,
  SetRolePermissionsDto,
} from './dto/authz.dto';

function toRoleDto(r: RoleWithPermissions): RoleResponseDto {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    system: r.system,
    permissions: r.permissions,
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toAssignmentDto(a: RoleAssignment): RoleAssignmentResponseDto {
  return {
    id: a.id,
    userId: a.userId,
    roleId: a.roleId,
    scopeType: a.scopeType,
    scopeId: a.scopeId,
    grantedBy: a.grantedBy,
    expiresAt: a.expiresAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

function toDelegationDto(d: ApprovalDelegation): DelegationResponseDto {
  return {
    id: d.id,
    fromUserId: d.fromUserId,
    toUserId: d.toUserId,
    startsAt: d.startsAt.toISOString(),
    endsAt: d.endsAt.toISOString(),
    reason: d.reason,
    createdAt: d.createdAt.toISOString(),
  };
}

@ApiTags('authz')
@Controller('authz')
export class AuthzController {
  constructor(
    private readonly authz: AuthzAdminService,
    private readonly delegation: DelegationService,
    private readonly audit: AuditService,
  ) {}

  @Get('permissions')
  @RequirePermission('rbac.read')
  @ApiOperation({ summary: 'List the permission catalog' })
  @ApiOkResponse({ type: [PermissionResponseDto] })
  @ApiCommonErrors(401, 403)
  async listPermissions(): Promise<PermissionResponseDto[]> {
    return (await this.authz.listPermissions()) satisfies Permission[];
  }

  @Get('roles')
  @RequirePermission('rbac.read')
  @ApiOperation({ summary: 'List roles with their permissions' })
  @ApiOkResponse({ type: [RoleResponseDto] })
  @ApiCommonErrors(401, 403)
  async listRoles(): Promise<RoleResponseDto[]> {
    return (await this.authz.listRoles()).map(toRoleDto);
  }

  @Get('roles/:id')
  @RequirePermission('rbac.read')
  @ApiOperation({ summary: 'Get a role by id' })
  @ApiOkResponse({ type: RoleResponseDto })
  @ApiCommonErrors(401, 403, 404)
  async getRole(@Param('id') id: string): Promise<RoleResponseDto> {
    return toRoleDto(await this.authz.getRole(id));
  }

  @Post('roles')
  @RequirePermission('rbac.manage')
  @ApiOperation({ summary: 'Create a custom role' })
  @ApiCreatedResponse({ type: RoleResponseDto })
  @ApiCommonErrors(401, 403, 409, 422)
  async createRole(
    @Body() dto: CreateRoleDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<RoleResponseDto> {
    const role = await this.authz.createRole(dto, { sub: user.sub, email: user.email });
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: 'rbac.role_created',
      resourceType: 'role',
      resourceId: role.id,
      metadata: { key: role.key, name: role.name },
    });
    return toRoleDto(role);
  }

  @Put('roles/:id/permissions')
  @RequirePermission('rbac.manage')
  @ApiOperation({ summary: 'Replace a role’s permission set' })  @ApiOkResponse({ type: RoleResponseDto })  @ApiCommonErrors(401, 403, 404, 422)
  async setRolePermissions(
    @Param('id') id: string,
    @Body() dto: SetRolePermissionsDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<RoleResponseDto> {
    const role = await this.authz.setRolePermissions(id, dto.permissions, {
      sub: user.sub,
      email: user.email,
    });
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: 'rbac.role_permissions_updated',
      resourceType: 'role',
      resourceId: id,
      metadata: { permissions: dto.permissions },
    });
    return toRoleDto(role);
  }

  @Delete('roles/:id')
  @HttpCode(204)
  @RequirePermission('rbac.manage')
  @ApiOperation({ summary: 'Delete a custom (non-system) role' })
  @ApiNoContentResponse()
  @ApiCommonErrors(401, 403, 404, 422)
  async deleteRole(@Param('id') id: string, @CurrentUser() user: JwtPayload): Promise<void> {
    await this.authz.deleteRole(id, { sub: user.sub, email: user.email });
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: 'rbac.role_deleted',
      resourceType: 'role',
      resourceId: id,
    });
  }

  @Get('users/:userId/assignments')
  @RequirePermission('rbac.read')
  @ApiOperation({ summary: 'List a user’s role assignments' })  @ApiOkResponse({ type: [RoleAssignmentResponseDto] })  @ApiCommonErrors(401, 403)
  async listUserAssignments(
    @Param('userId') userId: string,
  ): Promise<RoleAssignmentResponseDto[]> {
    return (await this.authz.listUserAssignments(userId)).map(toAssignmentDto);
  }

  @Post('assignments')
  @RequirePermission('role.assign')
  @ApiOperation({ summary: 'Grant a scoped role to a user' })
  @ApiCreatedResponse({ type: RoleAssignmentResponseDto })
  @ApiCommonErrors(401, 403, 404, 422)
  async assignRole(
    @Body() dto: AssignRoleDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<RoleAssignmentResponseDto> {
    const assignment = await this.authz.assignRole(
      {
        userId: dto.userId,
        roleId: dto.roleId,
        scopeType: dto.scopeType,
        scopeId: dto.scopeId ?? null,
        expiresAt: dto.expiresAt ?? null,
      },
      { sub: user.sub, email: user.email },
    );
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: 'rbac.role_assigned',
      resourceType: 'role_assignment',
      resourceId: assignment.id,
      metadata: { userId: dto.userId, roleId: dto.roleId, scopeType: dto.scopeType, scopeId: dto.scopeId ?? null },
    });
    return toAssignmentDto(assignment);
  }

  @Delete('assignments/:id')
  @HttpCode(204)
  @RequirePermission('role.assign')
  @ApiOperation({ summary: 'Revoke a role assignment' })
  @ApiNoContentResponse()
  @ApiCommonErrors(401, 403, 404)
  async revokeAssignment(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.authz.revokeAssignment(id, { sub: user.sub, email: user.email });
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: 'rbac.role_assignment_revoked',
      resourceType: 'role_assignment',
      resourceId: id,
    });
  }

  // ── Approval Delegation ────────────────────────────────────────────────────

  @Post('delegations')
  @ApiOperation({
    summary: 'Create an approval delegation',
    description:
      'Delegates your approval authority to another user for a specified time window. ' +
      'Useful for out-of-office coverage.',
  })
  @ApiCreatedResponse({ type: DelegationResponseDto })
  @ApiCommonErrors(401, 422)
  async createDelegation(
    @Body() dto: CreateDelegationDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<DelegationResponseDto> {
    const d = await this.delegation.create({
      fromUserId: user.sub,
      toUserId: dto.toUserId,
      startsAt: dto.startsAt,
      endsAt: dto.endsAt,
      reason: dto.reason,
    });
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: 'rbac.delegation_created',
      resourceType: 'delegation',
      resourceId: d.id,
      metadata: { toUserId: dto.toUserId, startsAt: dto.startsAt, endsAt: dto.endsAt },
    });
    return toDelegationDto(d);
  }

  @Get('delegations')
  @ApiOperation({
    summary: 'List approval delegations',
    description:
      'Use `?direction=from` (default) to list delegations you created; ' +
      '`?direction=to` for delegations you received.',
  })
  @ApiOkResponse({ type: [DelegationResponseDto] })
  @ApiCommonErrors(401)
  async listDelegations(
    @Query() query: ListDelegationsQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<DelegationResponseDto[]> {
    const rows =
      query.direction === 'to'
        ? await this.delegation.listTo(user.sub)
        : await this.delegation.listFrom(user.sub);
    return rows.map(toDelegationDto);
  }

  @Delete('delegations/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke an approval delegation' })
  @ApiNoContentResponse()
  @ApiCommonErrors(401, 403, 404)
  async revokeDelegation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.delegation.revoke(id, user.sub);
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: 'rbac.delegation_revoked',
      resourceType: 'delegation',
      resourceId: id,
    });
  }
}
