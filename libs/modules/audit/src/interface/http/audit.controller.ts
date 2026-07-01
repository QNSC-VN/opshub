import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  RequirePermission,
  ApiCommonErrors,
  ApiPagedResponse,
  buildPageResult,
  RateLimit,
} from '@platform';
import type { PagedResult } from '@platform';
import { AuditService } from '../../application/audit.service';
import { AuditQueryDto, AuditLogResponseDto } from './dto/audit.dto';
import type { AuditLog } from '../../domain/audit.types';

function toDto(a: AuditLog): AuditLogResponseDto {
  return {
    id: a.id,
    actorId: a.actorId,
    actorEmail: a.actorEmail,
    action: a.action,
    resourceType: a.resourceType,
    resourceId: a.resourceId,
    changes: a.changes,
    metadata: a.metadata,
    occurredAt: a.occurredAt.toISOString(),
  };
}

@ApiTags('audit')
@Controller('audit-logs')
@RequirePermission('audit.read')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RateLimit('STRICT')
  @ApiOperation({ summary: 'Query OpsHub audit logs' })
  @ApiPagedResponse(AuditLogResponseDto)
  @ApiCommonErrors(401, 403, 422)
  async list(@Query() query: AuditQueryDto): Promise<PagedResult<AuditLogResponseDto>> {
    const { rows, total } = await this.auditService.list(
      {
        actorId: query.actorId,
        resourceType: query.resourceType,
        resourceId: query.resourceId,
        action: query.action,
      },
      query.limit,
      query.offset,
    );
    return buildPageResult(rows.map(toDto), total, query.limit, query.offset);
  }
}
