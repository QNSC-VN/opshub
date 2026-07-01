import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Auth, RequirePermission, ApiCommonErrors, CurrentUser, AuthzService } from '@platform';
import type { JwtPayload } from '@platform';
import { CatalogService } from '../../application/catalog.service';
import type { CatalogItem } from '../../domain/catalog.types';
import {
  CreateCatalogItemDto,
  UpdateCatalogItemDto,
  SubmitCatalogRequestDto,
  CatalogItemResponseDto,
} from './dto/catalog.dto';

function toDto(c: CatalogItem): CatalogItemResponseDto {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    category: c.category,
    iconEmoji: c.iconEmoji,
    approvalPermission: c.approvalPermission,
    slaHours: c.slaHours,
    isActive: c.isActive,
    sortOrder: c.sortOrder,
    createdAt: c.createdAt.toISOString(),
  };
}

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly authz: AuthzService,
  ) {}

  @Get()
  @Auth()
  @ApiOperation({ summary: 'List active service catalog items' })
  @ApiOkResponse({ type: CatalogItemResponseDto, isArray: true })
  @ApiCommonErrors(401)
  async list(
    @Query('includeInactive') includeInactive?: string,
    @CurrentUser() user?: JwtPayload,
  ): Promise<CatalogItemResponseDto[]> {
    // Only catalog managers may see inactive items.
    const showAll =
      includeInactive === 'true' && !!user && (await this.authz.check(user.sub, 'catalog.manage'));
    return (await this.catalogService.listItems(showAll)).map(toDto);
  }

  @Post()
  @RequirePermission('catalog.manage')
  @ApiOperation({ summary: 'Create a catalog item (admin)' })
  @ApiCreatedResponse({ type: CatalogItemResponseDto })
  @ApiCommonErrors(400, 401, 403)
  async create(
    @Body() dto: CreateCatalogItemDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<CatalogItemResponseDto> {
    return toDto(await this.catalogService.createItem(dto, { sub: user.sub, email: user.email }));
  }

  @Get(':id')
  @Auth()
  @ApiOperation({ summary: 'Get a catalog item by id' })
  @ApiOkResponse({ type: CatalogItemResponseDto })
  @ApiCommonErrors(401, 404)
  async getById(@Param('id') id: string): Promise<CatalogItemResponseDto> {
    return toDto(await this.catalogService.getItem(id));
  }

  @Patch(':id')
  @RequirePermission('catalog.manage')
  @ApiOperation({ summary: 'Update a catalog item' })
  @ApiOkResponse({ type: CatalogItemResponseDto })
  @ApiCommonErrors(400, 401, 403, 404)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCatalogItemDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<CatalogItemResponseDto> {
    return toDto(
      await this.catalogService.updateItem(id, dto, { sub: user.sub, email: user.email }),
    );
  }

  @Delete(':id')
  @RequirePermission('catalog.manage')
  @ApiOperation({ summary: 'Delete a catalog item' })
  @ApiNoContentResponse()
  @ApiCommonErrors(401, 403, 404)
  async delete(@Param('id') id: string, @CurrentUser() user: JwtPayload): Promise<void> {
    await this.catalogService.deleteItem(id, { sub: user.sub, email: user.email });
  }

  @Post(':id/request')
  @Auth()
  @ApiOperation({ summary: 'Submit a service catalog request' })
  @ApiCreatedResponse({ schema: { properties: { requestId: { type: 'string' } } } })
  @ApiCommonErrors(400, 401, 404)
  async submitRequest(
    @Param('id') id: string,
    @Body() dto: SubmitCatalogRequestDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ requestId: string }> {
    return this.catalogService.submitRequest(id, dto.reason, { sub: user.sub, email: user.email });
  }
}
