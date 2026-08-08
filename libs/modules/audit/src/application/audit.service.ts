import { Inject, Injectable, Logger } from '@nestjs/common';
import { newId } from '@shared-kernel';
import type { DbExecutor } from '@platform';
import { AUDIT_REPOSITORY, type IAuditRepository } from '../domain/ports/audit.repository';
import type { AuditFilters, AuditLog, CreateAuditLogInput } from '../domain/audit.types';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(AUDIT_REPOSITORY) private readonly auditRepo: IAuditRepository) {}

  /**
   * Record an action.
   *
   * PASS THE CALLER'S TRANSACTION. With `tx`, the audit row commits with the mutation it
   * records and rolls back with it — the entry cannot describe a change that did not happen,
   * and a change cannot happen unrecorded. Every call used to be
   * `void this.audit.record({...})`: fire-and-forget, outside any transaction, with the
   * failure swallowed below. A mutation that committed while its audit write lost the race,
   * or failed, left no trace and nothing to alert on.
   *
   * SWALLOWS ERRORS ONLY WITHOUT A TRANSACTION. Inside one, a swallowed failure would defeat
   * the point: the mutation would commit and the entry would be missing, which is the exact
   * state `tx` exists to prevent. So the error propagates and takes the transaction down with
   * it. Without a `tx` there is nothing to roll back and crashing the caller would be worse
   * than a logged gap, so the old behaviour stands for those sites until they are converted.
   */
  async record(input: Omit<CreateAuditLogInput, 'id'>, tx?: DbExecutor): Promise<void> {
    if (tx) {
      await this.auditRepo.create({ id: newId(), ...input }, tx);
      return;
    }
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
