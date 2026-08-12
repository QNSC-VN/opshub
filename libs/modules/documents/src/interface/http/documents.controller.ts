import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiCommonErrors,
  ApiPagedResponse,
  Auth,
  AuthorizedInService,
  CurrentUser,
  RequirePermission,
  SelfScoped,
  buildPageResult,
  type JwtPayload,
  type PagedResult,
} from '@platform';
import { EmployeeService } from '@modules/identity';
import { DocumentsService } from '../../application/documents.service';
import type {
  ControlledDocument,
  DocumentVersion,
  OutstandingAcknowledgement,
} from '../../domain/documents.types';
import {
  AcknowledgedByResponseDto,
  AcknowledgementResponseDto,
  CreateDocumentDto,
  CreateDraftDto,
  DocumentResponseDto,
  DocumentVersionResponseDto,
  ListDocumentsQueryDto,
  OutstandingAcknowledgementResponseDto,
  PublishVersionDto,
} from './dto/documents.dto';

function toDocumentDto(d: ControlledDocument): DocumentResponseDto {
  return {
    id: d.id,
    code: d.code,
    title: d.title,
    category: d.category,
    ownerId: d.ownerId,
    retiredAt: d.retiredAt ? d.retiredAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
  };
}

function toVersionDto(v: DocumentVersion): DocumentVersionResponseDto {
  return {
    id: v.id,
    documentId: v.documentId,
    version: v.version,
    body: v.body,
    changeSummary: v.changeSummary,
    status: v.status,
    requestId: v.requestId,
    approvedBy: v.approvedBy,
    approvedAt: v.approvedAt ? v.approvedAt.toISOString() : null,
    publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
    reviewDueOn: v.reviewDueOn,
    supersededAt: v.supersededAt ? v.supersededAt.toISOString() : null,
    createdAt: v.createdAt.toISOString(),
  };
}

function toOutstandingDto(o: OutstandingAcknowledgement): OutstandingAcknowledgementResponseDto {
  return {
    documentId: o.documentId,
    code: o.code,
    title: o.title,
    category: o.category,
    versionId: o.versionId,
    version: o.version,
    publishedAt: new Date(o.publishedAt).toISOString(),
  };
}

@ApiTags('documents')
@Controller('documents')
@Auth()
export class DocumentsController {
  constructor(
    private readonly service: DocumentsService,
    private readonly employees: EmployeeService,
  ) {}

  // ── The employee-facing half ────────────────────────────────────────────────

  /**
   * Documents the CALLER still has to acknowledge.
   *
   * Self-scoped and listed first because it is the only route in this module most employees ever
   * touch. It exists because acknowledgements are keyed on the VERSION: publishing a new revision
   * makes it reappear here for everyone, which is the behaviour ISO expects and the reason this
   * question can be answered at all.
   */
  @Get('acknowledgements/outstanding')
  @SelfScoped("lists the versions the caller has not acknowledged — keyed on the caller's own id")
  @ApiOperation({ summary: 'Documents awaiting my acknowledgement' })
  @ApiOkResponse({ type: [OutstandingAcknowledgementResponseDto] })
  @ApiCommonErrors(401)
  async listOutstanding(
    @CurrentUser() user: JwtPayload,
  ): Promise<OutstandingAcknowledgementResponseDto[]> {
    return (await this.service.listOutstanding(user.sub)).map(toOutstandingDto);
  }

  /** Acknowledge the version in force. Idempotent — a second call is the same acknowledgement. */
  @Post('versions/:id/acknowledge')
  // A state transition, not a creation. Without this Nest answers 201 while `@ApiOkResponse`
  // documents 200, so the generated client's contract disagreed with the server — measured.
  @HttpCode(HttpStatus.OK)
  @SelfScoped('records the CALLER as having read the version; the actor is the subject')
  @ApiOperation({
    summary: 'Acknowledge a published document version',
    description:
      'Only the published, non-superseded version can be acknowledged: consenting to a draft ' +
      'means nothing, and consenting to a superseded one reads as current compliance when it is ' +
      'not.',
  })
  @ApiOkResponse({ type: AcknowledgementResponseDto })
  @ApiCommonErrors(401, 404, 412)
  async acknowledge(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<AcknowledgementResponseDto> {
    return this.service.acknowledge(id, user);
  }

  // ── The library ─────────────────────────────────────────────────────────────

  @Get()
  @RequirePermission('documents.read')
  @ApiOperation({
    summary: 'List controlled documents',
    description:
      'Retired documents are excluded unless `includeRetired` is set — retirement is soft.',
  })
  @ApiPagedResponse(DocumentResponseDto)
  @ApiCommonErrors(401, 403)
  async list(@Query() query: ListDocumentsQueryDto): Promise<PagedResult<DocumentResponseDto>> {
    const { rows, total } = await this.service.listDocuments(
      {
        category: query.category,
        ownerId: query.ownerId,
        includeRetired: query.includeRetired,
        search: query.search,
      },
      query.limit,
      query.offset,
    );
    return buildPageResult(rows.map(toDocumentDto), total, query.limit, query.offset);
  }

  @Get(':id')
  @RequirePermission('documents.read')
  @ApiOperation({ summary: 'Get a controlled document' })
  @ApiOkResponse({ type: DocumentResponseDto })
  @ApiCommonErrors(401, 403, 404)
  async getById(@Param('id', ParseUUIDPipe) id: string): Promise<DocumentResponseDto> {
    return toDocumentDto(await this.service.getDocument(id));
  }

  @Get(':id/versions')
  @RequirePermission('documents.read')
  @ApiOperation({ summary: 'Revision history, newest first' })
  @ApiOkResponse({ type: [DocumentVersionResponseDto] })
  @ApiCommonErrors(401, 403, 404)
  async listVersions(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DocumentVersionResponseDto[]> {
    return (await this.service.listVersions(id)).map(toVersionDto);
  }

  @Post()
  @RequirePermission('documents.manage')
  @ApiOperation({
    summary: 'Register a document and open its first draft',
    description: 'Created together: a document with no version has nothing to edit or publish.',
  })
  @ApiCreatedResponse({ type: DocumentResponseDto })
  @ApiCommonErrors(401, 403, 409, 422)
  async create(
    @Body() dto: CreateDocumentDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<DocumentResponseDto> {
    // The owner must exist: `owner_id` carries no cross-schema FK, matching the rest of the
    // codebase, so a typo would otherwise become a document nobody is accountable for.
    await this.employees.getById(dto.ownerId);
    return toDocumentDto(await this.service.createDocument(dto, user));
  }

  @Post(':id/versions')
  @RequirePermission('documents.manage')
  @ApiOperation({
    summary: 'Open a new draft',
    description:
      'The only way to change a published document: a published version is immutable, because ' +
      'which revision was in force on a given date has to stay answerable.',
  })
  @ApiCreatedResponse({ type: DocumentVersionResponseDto })
  @ApiCommonErrors(401, 403, 404, 422)
  async createDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateDraftDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<DocumentVersionResponseDto> {
    return toVersionDto(await this.service.createDraft(id, dto, user));
  }

  @Put('versions/:id')
  @RequirePermission('documents.manage')
  @ApiOperation({ summary: 'Edit a draft' })
  @ApiOkResponse({ type: DocumentVersionResponseDto })
  @ApiCommonErrors(401, 403, 404, 412)
  async updateDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateDraftDto,
  ): Promise<DocumentVersionResponseDto> {
    return toVersionDto(await this.service.updateDraft(id, dto));
  }

  @Post('versions/:id/submit')
  // A state transition, not a creation. Without this Nest answers 201 while `@ApiOkResponse`
  // documents 200, so the generated client's contract disagreed with the server — measured.
  @HttpCode(HttpStatus.OK)
  @AuthorizedInService(
    'hands the draft to RequestEngine, which enforces the approval permission and separation of duties per step',
    'controlled-documents.e2e.spec.ts',
  )
  @ApiOperation({
    summary: 'Submit a draft for approval',
    description:
      'Creates an engine request. The approver needs `documents.approve`, and the engine refuses ' +
      'a self-approval — an author must not approve their own policy.',
  })
  @ApiOkResponse({ type: DocumentVersionResponseDto })
  @ApiCommonErrors(401, 404, 412)
  async submit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<DocumentVersionResponseDto> {
    return toVersionDto(await this.service.submitForApproval(id, user));
  }

  @Post('versions/:id/publish')
  // A state transition, not a creation. Without this Nest answers 201 while `@ApiOkResponse`
  // documents 200, so the generated client's contract disagreed with the server — measured.
  @HttpCode(HttpStatus.OK)
  @RequirePermission('documents.publish')
  @ApiOperation({
    summary: 'Put an approved version into force',
    description:
      'Supersedes the version it replaces, in one transaction. Separate from approval because a ' +
      'policy is routinely approved before the date it takes effect.',
  })
  @ApiOkResponse({ type: DocumentVersionResponseDto })
  @ApiCommonErrors(401, 403, 404, 412)
  async publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishVersionDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<DocumentVersionResponseDto> {
    return toVersionDto(await this.service.publish(id, dto, user));
  }

  @Get('versions/:id/acknowledgements')
  @RequirePermission('documents.read')
  @ApiOperation({ summary: 'Who has acknowledged this version' })
  @ApiOkResponse({ type: [AcknowledgedByResponseDto] })
  @ApiCommonErrors(401, 403, 404)
  async listAcknowledgedBy(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AcknowledgedByResponseDto[]> {
    return (await this.service.listAcknowledgedBy(id)).map((a) => ({
      employeeId: a.employeeId,
      acknowledgedAt: a.acknowledgedAt.toISOString(),
    }));
  }

  @Delete(':id')
  @RequirePermission('documents.manage')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Retire a document',
    description:
      'Soft. Versions are never deleted, because a superseded control still has to be ' +
      'explainable years later.',
  })
  @ApiNoContentResponse()
  @ApiCommonErrors(401, 403, 404, 412)
  async retire(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.service.retireDocument(id, user);
  }
}
