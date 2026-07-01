import { Inject, Injectable, Logger } from '@nestjs/common';
import { newId } from '@shared-kernel';
import {
  AUDIT_REPOSITORY,
  type IAuditRepository,
} from '../domain/ports/audit.repository';
import type { AuditFilters, AuditLog, CreateAuditLogInput } from '../domain/audit.types';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(AUDIT_REPOSITORY) private readonly auditRepo: IAuditRepository) {}

  /** Record an action. Never throws — audit must not crash the caller. */
  async record(input: Omit<CreateAuditLogInput, 'id'>): Promise<void> {
    try {
      await this.auditRepo.create({ id: newId(), ...input });
    } catch (err) {
      this.logger.error({ err, action: input.action }, 'Failed to write audit log');
    }
  }

  async list(
    filters: AuditFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: AuditLog[]; total: number }> {
    return this.auditRepo.list(filters, limit, offset);
  }
}
