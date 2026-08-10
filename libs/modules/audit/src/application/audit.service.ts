import { Inject, Injectable, Logger } from '@nestjs/common';
import { newId } from '@shared-kernel';
import type { DbExecutor } from '@platform';
import type { Actor } from '@shared-kernel';
import { AUDIT_REPOSITORY, type IAuditRepository } from '../domain/ports/audit.repository';
import type { AuditFilters, AuditLog, CreateAuditLogInput } from '../domain/audit.types';
import type { AuditAction, AuditResource } from '../domain/audit-catalogue';

/** The before/after pair an audit entry carries. Named because six services declared it inline. */
export interface AuditChanges {
  before?: object | null;
  after?: object | null;
}

/**
 * A recorder with its resource type already bound — see {@link AuditService.forResource}.
 *
 * The argument order matches the private wrappers it replaces, so call sites did not have to move.
 */
export interface ResourceAuditTrail {
  record(
    action: AuditAction,
    resourceId: string,
    actor: Actor,
    tx: DbExecutor | undefined,
    changes: AuditChanges,
  ): Promise<void>;
}

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

  /**
   * Record a change made BY an actor TO a resource.
   *
   * This is the shape every mutating service actually needs, and each of them had grown a private
   * three-line `record()` wrapper to reach it — six identical copies, whose only real content was
   * flattening `Actor` into `actorId`/`actorEmail`. That flattening now happens once, here, so a
   * change to how an actor is identified in the trail is a change to one function.
   */
  async recordChange(
    actor: Actor,
    action: AuditAction,
    resourceType: AuditResource,
    resourceId: string,
    changes: AuditChanges,
    tx?: DbExecutor,
  ): Promise<void> {
    await this.record(
      { actorId: actor.sub, actorEmail: actor.email, action, resourceType, resourceId, changes },
      tx,
    );
  }

  /**
   * A recorder bound to ONE resource type.
   *
   * For the common case — a service that only ever audits its own aggregate. The resource type is
   * named once, in the constructor, instead of at every call site where it can drift: an
   * information-asset service writing `AUDIT_RESOURCE.INCIDENT` compiles perfectly well and is
   * invisible until somebody reads the trail.
   */
  forResource(resourceType: AuditResource): ResourceAuditTrail {
    return {
      record: (action, resourceId, actor, tx, changes) =>
        this.recordChange(actor, action, resourceType, resourceId, changes, tx),
    };
  }

  async list(
    filters: AuditFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: AuditLog[]; total: number }> {
    return this.auditRepo.list(filters, limit, offset);
  }
}
