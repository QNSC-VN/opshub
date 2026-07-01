import { Controller, Get, Post, Param, Query, Body, ParseUUIDPipe, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import {
  Auth,
  CurrentUser,
  type JwtPayload,
  RequestEngine,
  buildPageResult,
  type PagedResult,
  NotFoundException,
  ErrorCodes,
  type RequestItemWithApprovals,
  type RequestComment,
  ApiPagedResponse,
} from '@platform';
import { AuditService } from '@modules/audit';
import {
  ListRequestsQueryDto,
  ReviewRequestDto,
  AddCommentDto,
  RequestItemResponseDto,
  RequestApprovalResponseDto,
  RequestCommentResponseDto,
} from './dto/requests.dto';

function toApprovalDto(a: RequestItemWithApprovals['approvals'][number]): RequestApprovalResponseDto {
  return {
    id: a.id,
    requestId: a.requestId,
    step: a.step,
    approverId: a.approverId,
    decision: a.decision,
    note: a.note,
    delegatedFromId: a.delegatedFromId,
    decidedAt: a.decidedAt.toISOString(),
  };
}

function toDto(r: RequestItemWithApprovals): RequestItemResponseDto {
  return {
    id: r.id,
    type: r.type,
    requesterId: r.requesterId,
    assigneeId: r.assigneeId,
    status: r.status,
    priority: r.priority,
    payload: r.payload,
    resolutionNote: r.resolutionNote,
    submittedAt: r.submittedAt.toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
    slaHours: r.slaHours,
    slaDeadline: r.slaDeadline ? r.slaDeadline.toISOString() : null,
    slaBreachedAt: r.slaBreachedAt ? r.slaBreachedAt.toISOString() : null,
    currentStep: r.currentStep,
    totalSteps: r.totalSteps,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    approvals: r.approvals.map(toApprovalDto),
  };
}

function toCommentDto(c: RequestComment): RequestCommentResponseDto {
  return {
    id: c.id,
    requestId: c.requestId,
    authorId: c.authorId,
    body: c.body,
    editedAt: c.editedAt ? c.editedAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
  };
}

@ApiTags('requests')
@Controller('requests')
export class RequestsController {
  constructor(
    private readonly engine: RequestEngine,
    private readonly audit: AuditService,
  ) {}

  private async mustGetById(id: string): Promise<RequestItemWithApprovals> {
    const item = await this.engine.getById(id);
    if (!item) {
      throw new NotFoundException(ErrorCodes.REQUEST_NOT_FOUND, 'Request not found');
    }
    return item;
  }

  /**
   * Unified inbox — lists request items across all types.
   * Use `myQueue=true` to get requests awaiting the caller's action.
   */
  @Get()
  @Auth()
  @ApiOperation({ summary: 'List request items (unified inbox)' })
  @ApiPagedResponse(RequestItemResponseDto)
  async list(
    @Query() query: ListRequestsQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<PagedResult<RequestItemResponseDto>> {
    const { rows, total } = await this.engine.list(
      {
        type: query.type,
        status: query.status,
        requesterId: query.requesterId,
        myQueue: query.myQueue,
      },
      user.sub,
      query.limit,
      query.offset,
    );

    // engine.list() now batch-loads approvals — no N+1
    return buildPageResult(rows.map(toDto), total, query.limit, query.offset);
  }

  /** Get a single request item with its full approval history. */
  @Get(':id')
  @Auth()
  @ApiOperation({ summary: 'Get request item with approval history' })
  @ApiOkResponse({ type: RequestItemResponseDto })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RequestItemResponseDto> {
    return toDto(await this.mustGetById(id));
  }

  /** Approve a pending request. Requires the relevant `*.approve` permission. */
  @Post(':id/approve')
  @Auth()
  @ApiOperation({ summary: 'Approve a pending request' })
  @ApiOkResponse({ type: RequestItemResponseDto })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewRequestDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<RequestItemResponseDto> {
    await this.engine.approve(id, dto.note ?? null, user);
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: 'request.approved',
      resourceType: 'request',
      resourceId: id,
      metadata: { note: dto.note ?? null },
    });
    return toDto(await this.mustGetById(id));
  }

  /** Reject a pending request. Requires the relevant `*.approve` permission. */
  @Post(':id/reject')
  @Auth()
  @ApiOperation({ summary: 'Reject a pending request' })
  @ApiOkResponse({ type: RequestItemResponseDto })
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewRequestDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<RequestItemResponseDto> {
    await this.engine.reject(id, dto.note ?? null, user);
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: 'request.rejected',
      resourceType: 'request',
      resourceId: id,
      metadata: { note: dto.note ?? null },
    });
    return toDto(await this.mustGetById(id));
  }

  /** Cancel a pending request (requester or admin). */
  @Post(':id/cancel')
  @Auth()
  @ApiOperation({ summary: 'Cancel a pending request' })
  @ApiOkResponse({ type: RequestItemResponseDto })
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewRequestDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<RequestItemResponseDto> {
    await this.engine.cancel(id, user);
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: 'request.cancelled',
      resourceType: 'request',
      resourceId: id,
    });
    return toDto(await this.mustGetById(id));
  }

  // ── Comments ───────────────────────────────────────────────────────────────

  /**
   * List discussion comments on a request, ordered oldest-first.
   * Comments are informational only — they do not affect request state.
   */
  @Get(':id/comments')
  @Auth()
  @ApiOperation({ summary: 'List comments on a request' })
  @ApiOkResponse({ type: [RequestCommentResponseDto] })
  async listComments(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RequestCommentResponseDto[]> {
    // Ensure request exists (throws 404 if not)
    await this.mustGetById(id);
    const comments = await this.engine.listComments(id);
    return comments.map(toCommentDto);
  }

  /** Post a discussion comment. Does not trigger any state transition. */
  @Post(':id/comments')
  @Auth()
  @HttpCode(201)
  @ApiOperation({ summary: 'Post a comment on a request' })
  @ApiCreatedResponse({ type: RequestCommentResponseDto })
  async addComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddCommentDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<RequestCommentResponseDto> {
    const comment = await this.engine.addComment(id, dto.body, user);
    void this.audit.record({
      actorId: user.sub,
      actorEmail: user.email,
      action: 'request.comment_added',
      resourceType: 'request',
      resourceId: id,
      metadata: { commentId: comment.id },
    });
    return toCommentDto(comment);
  }
}
