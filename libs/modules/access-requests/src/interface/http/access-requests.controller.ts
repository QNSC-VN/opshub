import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Auth,
  RequirePermission,
  ApiCommonErrors,
  ApiPagedResponse,
  buildPageResult,
  CurrentUser,
  SelfScoped,
  AuthorizedInService,
} from '@platform';
import type { JwtPayload, PagedResult } from '@platform';
import { AuditService } from '@modules/audit';
import { AccessRequestService } from '../../application/access-request.service';
import {
  SubmitAccessRequestDto,
  ReviewAccessRequestDto,
  ListAccessRequestsQueryDto,
  AccessRequestResponseDto,
  AccessGrantResponseDto,
} from './dto/access-request.dto';
import type { AccessGrant, AccessRequest } from '../../domain/access-request.types';

function toDto(r: AccessRequest): AccessRequestResponseDto {
  return {
    id: r.id,
    requesterId: r.requesterId,
    accessType: r.accessType,
    target: r.target,
    justification: r.justification,
    durationHours: r.durationHours,
    status: r.status,
    reviewerId: r.reviewerId,
    reviewNote: r.reviewNote,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

function toGrantDto(g: AccessGrant): AccessGrantResponseDto {
  return {
    id: g.id,
    requestId: g.requestId,
    granteeId: g.granteeId,
    accessType: g.accessType,
    target: g.target,
    grantedAt: g.grantedAt.toISOString(),
    expiresAt: g.expiresAt.toISOString(),
    revokedAt: g.revokedAt ? g.revokedAt.toISOString() : null,
  };
}

@ApiTags('access-requests')
@Controller('access-requests')
@Auth()
export class AccessRequestsController {
  constructor(
    private readonly service: AccessRequestService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @AuthorizedInService(
    'narrows to the caller unless they hold access_request.read',
    'request-visibility.e2e.spec.ts',
  )
  @ApiOperation({ summary: 'List access requests' })
  @ApiPagedResponse(AccessRequestResponseDto)
  @ApiCommonErrors(401)
  async list(
    @Query() query: ListAccessRequestsQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<PagedResult<AccessRequestResponseDto>> {
    const { rows, total } = await this.service.list(
      { requesterId: query.requesterId, status: query.status },
      query.limit,
      query.offset,
      user,
    );
    return buildPageResult(rows.map(toDto), total, query.limit, query.offset);
  }

  @Get(':id')
  @AuthorizedInService(
    'assertParty on the requester, else access_request.read',
    'request-visibility.e2e.spec.ts',
  )
  @ApiOperation({ summary: 'Get an access request by id' })
  @ApiOkResponse({ type: AccessRequestResponseDto })
  @ApiCommonErrors(401, 404)
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<AccessRequestResponseDto> {
    return toDto(await this.service.getById(id, user));
  }

  @Post()
  @SelfScoped('submits an access request FOR the caller — requesterId is actor.sub')
  @ApiOperation({ summary: 'Submit a privileged-access request' })
  @ApiCreatedResponse({ type: AccessRequestResponseDto })
  @ApiCommonErrors(401, 422)
  async submit(
    @Body() dto: SubmitAccessRequestDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<AccessRequestResponseDto> {
    const result = await this.service.submit(dto, user);
    return toDto(result);
  }

  @Post(':id/approve')
  @RequirePermission('access_request.security_approve')
  /**
   * Returns the REQUEST as it now stands, not a grant: approval advances one step of a
   * multi-step workflow, and an intermediate step issues no grant — the request stays
   * `pending` for the next approver. Returning a grant here 500'd on exactly that case.
   * The resulting `status` is what tells the caller whether anything further is needed.
   */
  @ApiOperation({ summary: 'Approve one step of a request; issues a grant on the final step' })
  @ApiCreatedResponse({ type: AccessRequestResponseDto })
  @ApiCommonErrors(401, 403, 404, 412)
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewAccessRequestDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<AccessRequestResponseDto> {
    const request = await this.service.approve(id, dto.note ?? null, user);
    return toDto(request);
  }

  @Post(':id/reject')
  // 200, not Nest's default 201: this is a state transition, not a creation, and `@ApiOkResponse`
  // already promises 200 — without this the generated client's contract disagreed with the server.
  @HttpCode(HttpStatus.OK)
  @RequirePermission('access_request.security_approve')
  @ApiOperation({ summary: 'Reject a pending request' })
  @ApiOkResponse({ type: AccessRequestResponseDto })
  @ApiCommonErrors(401, 403, 404, 412)
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewAccessRequestDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<AccessRequestResponseDto> {
    const result = await this.service.reject(id, dto.note ?? null, user);
    return toDto(result);
  }

  @Post('grants/:grantId/revoke')
  // 200, not Nest's default 201: this is a state transition, not a creation, and `@ApiOkResponse`
  // already promises 200 — without this the generated client's contract disagreed with the server.
  @HttpCode(HttpStatus.OK)
  @RequirePermission('access_request.security_approve')
  @ApiOperation({ summary: 'Revoke an active grant' })
  @ApiOkResponse({ schema: { type: 'object', properties: { status: { type: 'string' } } } })
  @ApiCommonErrors(401, 403, 404, 412)
  async revoke(
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ status: string }> {
    await this.service.revokeGrant(grantId, user);
    return { status: 'revoked' };
  }

  @Get('grants/me/active')
  @SelfScoped('lists the callers own active grants — listActiveGrants(user.sub)')
  @ApiOperation({ summary: 'List my active grants' })
  @ApiOkResponse({ type: [AccessGrantResponseDto] })
  @ApiCommonErrors(401)
  async myGrants(@CurrentUser() user: JwtPayload): Promise<AccessGrantResponseDto[]> {
    return (await this.service.listActiveGrants(user.sub)).map(toGrantDto);
  }
}
