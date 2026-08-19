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
  RateLimit,
  ApiCommonErrors,
  ApiPagedResponse,
  buildPageResult,
  CurrentUser,
} from '@platform';
import type { JwtPayload, PagedResult } from '@platform';
import { AuditService } from '@modules/audit';
import { AssetService } from '../../application/asset.service';
import {
  CreateAssetDto,
  ListAssetsQueryDto,
  AssignAssetDto,
  AssetResponseDto,
  AssetAssignmentResponseDto,
  PresignAssetPhotoDto,
  ConfirmAssetPhotoDto,
} from './dto/asset.dto';
import type { Asset, AssetAssignment } from '../../domain/asset.types';

function toDto(a: Asset): AssetResponseDto {
  return {
    id: a.id,
    assetTag: a.assetTag,
    type: a.type,
    status: a.status,
    manufacturer: a.manufacturer,
    model: a.model,
    serialNumber: a.serialNumber,
    mdmDeviceId: a.mdmDeviceId,
    purchaseDate: a.purchaseDate,
    warrantyExpiry: a.warrantyExpiry,
    specs: a.specs,
    assignedTo: a.assignedTo,
    photoStorageKey: a.photoStorageKey,
    createdAt: a.createdAt.toISOString(),
  };
}

function toAssignmentDto(a: AssetAssignment): AssetAssignmentResponseDto {
  return {
    id: a.id,
    assetId: a.assetId,
    employeeId: a.employeeId,
    assignedAt: a.assignedAt.toISOString(),
    returnedAt: a.returnedAt ? a.returnedAt.toISOString() : null,
    notes: a.notes,
  };
}

@ApiTags('assets')
@Controller('assets')
@Auth()
export class AssetsController {
  constructor(
    private readonly assetService: AssetService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('asset.read')
  @ApiOperation({ summary: 'List hardware assets' })
  @ApiPagedResponse(AssetResponseDto)
  @ApiCommonErrors(401)
  async list(@Query() query: ListAssetsQueryDto): Promise<PagedResult<AssetResponseDto>> {
    const { rows, total } = await this.assetService.list(
      {
        status: query.status,
        type: query.type,
        assignedTo: query.assignedTo,
        search: query.search,
      },
      query.limit,
      query.offset,
    );
    return buildPageResult(rows.map(toDto), total, query.limit, query.offset);
  }

  @Get(':id')
  @RequirePermission('asset.read')
  @ApiOperation({ summary: 'Get an asset by id' })
  @ApiOkResponse({ type: AssetResponseDto })
  @ApiCommonErrors(401, 404)
  async getById(@Param('id', ParseUUIDPipe) id: string): Promise<AssetResponseDto> {
    return toDto(await this.assetService.getById(id));
  }

  @Get(':id/assignments')
  @RequirePermission('asset.read')
  @ApiOperation({ summary: 'List the assignment history of an asset' })
  @ApiOkResponse({ type: [AssetAssignmentResponseDto] })
  @ApiCommonErrors(401, 404)
  async assignments(@Param('id', ParseUUIDPipe) id: string): Promise<AssetAssignmentResponseDto[]> {
    return (await this.assetService.listAssignments(id)).map(toAssignmentDto);
  }

  @Post()
  @RequirePermission('asset.write')
  @ApiOperation({ summary: 'Register a new asset' })
  @ApiCreatedResponse({ type: AssetResponseDto })
  @ApiCommonErrors(401, 403, 409, 422)
  async create(
    @Body() dto: CreateAssetDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<AssetResponseDto> {
    const asset = await this.assetService.create(dto, user);
    return toDto(asset);
  }

  @Post(':id/assign')
  // 200, not Nest's default 201: this is a state transition, not a creation, and `@ApiOkResponse`
  // already promises 200 — without this the generated client's contract disagreed with the server.
  @HttpCode(HttpStatus.OK)
  @RequirePermission('asset.reassign')
  @ApiOperation({ summary: 'Assign an asset to an employee' })
  @ApiOkResponse({ type: AssetResponseDto })
  @ApiCommonErrors(401, 403, 404, 409, 412)
  async assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignAssetDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<AssetResponseDto> {
    const asset = await this.assetService.assign(id, dto.employeeId, dto.notes ?? null, user);
    return toDto(asset);
  }

  @Post(':id/unassign')
  // 200, not Nest's default 201: this is a state transition, not a creation, and `@ApiOkResponse`
  // already promises 200 — without this the generated client's contract disagreed with the server.
  @HttpCode(HttpStatus.OK)
  @RequirePermission('asset.reassign')
  @ApiOperation({ summary: 'Return an asset to stock' })
  @ApiOkResponse({ type: AssetResponseDto })
  @ApiCommonErrors(401, 403, 404, 412)
  async unassign(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<AssetResponseDto> {
    const asset = await this.assetService.unassign(id, user);
    return toDto(asset);
  }

  @Post(':id/retire')
  // 200, not Nest's default 201: this is a state transition, not a creation, and `@ApiOkResponse`
  // already promises 200 — without this the generated client's contract disagreed with the server.
  @HttpCode(HttpStatus.OK)
  @RequirePermission('asset.write')
  @ApiOperation({ summary: 'Retire an asset' })
  @ApiOkResponse({ type: AssetResponseDto })
  @ApiCommonErrors(401, 403, 404)
  async retire(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<AssetResponseDto> {
    const asset = await this.assetService.retire(id, user);
    return toDto(asset);
  }

  // ── Photo upload ──────────────────────────────────────────────────────────

  @Post(':id/photo/presign')
  // 200, not Nest's default 201: this is a state transition, not a creation, and `@ApiOkResponse`
  // already promises 200 — without this the generated client's contract disagreed with the server.
  @HttpCode(HttpStatus.OK)
  // Descriptored like `GET :id/photo` below, which it was not: READING an asset's photo evaluated the
  // caller's scope against the row, and REPLACING it did not. A constrained `asset.write` grant is
  // denied by a route that declares no scope to check it against, so the two ends of the same upload
  // answered differently for the same holder.
  @RequirePermission('asset.write', { resource: 'asset', from: 'param', field: 'id' })
  @RateLimit('UPLOAD')
  @ApiOperation({ summary: 'Get a presigned S3 PUT URL to upload an asset photo' })
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
  async presignPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PresignAssetPhotoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.assetService.presignPhoto(id, dto, { sub: user.sub, email: user.email });
  }

  @Post(':id/photo/confirm')
  // 200, not Nest's default 201: this is a state transition, not a creation, and `@ApiOkResponse`
  // already promises 200 — without this the generated client's contract disagreed with the server.
  @HttpCode(HttpStatus.OK)
  // Same descriptor as the presign above: a confirm that authorized more loosely than the presign
  // would let a caller finish an upload they could not have started.
  @RequirePermission('asset.write', { resource: 'asset', from: 'param', field: 'id' })
  @RateLimit('UPLOAD')
  @ApiOperation({ summary: 'Confirm asset photo upload completed' })
  @ApiOkResponse({
    schema: { properties: { photoUrl: { type: 'string' } }, required: ['photoUrl'] },
  })
  @ApiCommonErrors(401, 403, 404, 422)
  async confirmPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmAssetPhotoDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.assetService.confirmPhoto(id, dto.fileId, { sub: user.sub, email: user.email });
  }

  @Get(':id/photo')
  @RequirePermission('asset.read', { resource: 'asset', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Get a time-limited download URL for the asset photo' })
  @ApiOkResponse({
    schema: {
      properties: { photoUrl: { type: 'string', nullable: true } },
      required: ['photoUrl'],
    },
  })
  @ApiCommonErrors(401, 404)
  async getPhotoUrl(@Param('id', ParseUUIDPipe) id: string) {
    return this.assetService.getPhotoUrl(id);
  }
}
