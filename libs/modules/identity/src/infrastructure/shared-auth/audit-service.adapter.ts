import { Injectable } from '@nestjs/common';
import type { AuditRecordInput, IAuditService } from '@qnsc-vn/identity';
import { AuditService } from '@modules/audit';

/**
 * opshub binding for the shared `IAuditService` port. Bridges the package's
 * multi-tenant audit shape onto opshub's single-tenant audit log: `workspaceId`
 * and `projectId` are dropped, and transport metadata (`ipAddress`/`userAgent`)
 * is folded into the `metadata` bag since opshub's audit table has no dedicated
 * columns for them.
 */
@Injectable()
export class AuditServiceAdapter implements IAuditService {
  constructor(private readonly audit: AuditService) {}

  async record(input: AuditRecordInput): Promise<void> {
    const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
    if (input.ipAddress) {
      metadata.ipAddress = input.ipAddress;
    }
    if (input.userAgent) {
      metadata.userAgent = input.userAgent;
    }

    await this.audit.record({
      actorId: input.actorId ?? null,
      actorEmail: input.actorEmail ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      changes: input.changes,
      metadata,
    });
  }
}
