import { Inject, Injectable } from '@nestjs/common';
import {
  InjectDrizzle,
  type DrizzleDB,
  NotFoundException,
  ErrorCodes,
  PreconditionFailedException,
  RequestEngine,
  ActorScope,
} from '@platform';
import {
  AuditService,
  AUDIT_ACTION,
  AUDIT_RESOURCE,
  type ResourceAuditTrail,
} from '@modules/audit';
import { newId, MS_PER_HOUR } from '@shared-kernel';
import { eq } from 'drizzle-orm';
import { accessRequests } from '../../../../../db/schema';
import {
  ACCESS_REQUEST_REPOSITORY,
  type IAccessRequestRepository,
} from '../domain/ports/access-request.repository';
import type {
  AccessGrant,
  AccessRequest,
  AccessRequestFilters,
  CreateAccessRequestInput,
} from '../domain/access-request.types';
import type { AccessRequestPayload } from './access-request.type-def';

/**
 * Access requests and the grants they produce.
 *
 * AUDIT ENTRIES SHARE THEIR MUTATION'S TRANSACTION. All three writes here were fire-and-forget, so a
 * submitted request, a rejection or a REVOKED GRANT could leave nothing behind — and a revoked grant with no
 * entry is the one an access review most needs to see.
 *
 * THE ENGINE IS NOT IN THE TRANSACTION, deliberately. `RequestEngine.submit` writes its own row and lives in
 * `libs/platform`, so the domain row is created, the engine is asked, and the backlink plus the audit entry
 * commit together. If the engine call fails, the domain row is left without a `requestId` — visible and
 * repairable — which is a better failure than an approval item with nothing to approve.
 */
@Injectable()
export class AccessRequestService {
  private readonly requestTrail: ResourceAuditTrail;
  private readonly grantTrail: ResourceAuditTrail;

  constructor(
    @Inject(ACCESS_REQUEST_REPOSITORY) private readonly repo: IAccessRequestRepository,
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly engine: RequestEngine,
    audit: AuditService,
    private readonly actorScope: ActorScope,
  ) {
    this.requestTrail = audit.forResource(AUDIT_RESOURCE.ACCESS_REQUEST);
    this.grantTrail = audit.forResource(AUDIT_RESOURCE.ACCESS_GRANT);
  }

  async submit(
    input: Omit<CreateAccessRequestInput, 'requesterId'>,
    actor: { sub: string; email: string },
  ): Promise<AccessRequest> {
    // Create domain row first to get its id for the engine payload
    const domainRow = await this.repo.create({ ...input, requesterId: actor.sub });

    const enginePayload: AccessRequestPayload = {
      accessRequestId: domainRow.id,
      requesterId: actor.sub,
      accessType: input.accessType,
      target: input.target,
      justification: input.justification,
      durationHours: input.durationHours,
    };

    const engineItem = await this.engine.submit('access_request', enginePayload, actor, {
      expiresAt: new Date(Date.now() + 168 * MS_PER_HOUR), // 7-day default engine window
    });

    // The backlink and the entry describing the submission commit together: a request that says it went to
    // the engine and an entry saying it did are the same fact.
    await this.db.transaction(async (tx) => {
      await tx
        .update(accessRequests)
        .set({ requestId: engineItem.id })
        .where(eq(accessRequests.id, domainRow.id));
      await this.requestTrail.record(
        AUDIT_ACTION.ACCESS_REQUEST_SUBMITTED,
        domainRow.id,
        actor,
        tx,
        {
          after: {
            accessType: input.accessType,
            target: input.target,
            engineRequestId: engineItem.id,
          },
        },
      );
    });

    return { ...domainRow, requestId: engineItem.id };
  }

  /**
   * Read one access request, if the actor requested it or holds `access_request.read`.
   *
   * `actor` is optional ONLY for internal callers that have already authorized the read —
   * `approve`/`reject` gate on their own step permission, and an approver is not the requester.
   * A route must always pass it.
   */
  async getById(id: string, actor?: { sub: string }): Promise<AccessRequest> {
    const request = await this.repo.findById(id);
    if (!request) {
      throw new NotFoundException(ErrorCodes.ACCESS_REQUEST_NOT_FOUND, 'Access request not found');
    }
    if (actor) {
      await this.actorScope.assertParty(
        [request.requesterId],
        actor,
        'access_request.read',
        'access request',
      );
    }
    return request;
  }

  /**
   * List access requests, narrowed to the caller without `access_request.read`.
   *
   * The repository applies `requesterId` only when it is supplied, so an unfiltered call used to
   * return every access request in the system — target system, justification and approval state
   * included — to any authenticated caller.
   */
  async list(
    filters: AccessRequestFilters,
    limit: number,
    offset: number,
    actor: { sub: string },
  ): Promise<{ rows: AccessRequest[]; total: number }> {
    const scoped = await this.actorScope.narrowFilter(
      filters,
      'requesterId',
      actor,
      'access_request.read',
    );
    return this.repo.list(scoped, limit, offset);
  }

  /**
   * Approve one step of a request, returning the request as it now stands.
   *
   * NOT the grant, and that is the fix: with the engine path, approving advances a
   * MULTI-STEP workflow, and an intermediate step creates no grant at all — the request
   * stays `pending`, awaiting the next approver's `access_request.security_approve`. This
   * used to be declared `Promise<AccessGrant>` and ended with a query for a grant row that
   * does not exist yet, so it returned undefined and the controller threw
   * `TypeError: Cannot read properties of undefined (reading 'id')` — a 500 on an approval
   * that had in fact succeeded.
   *
   * TypeScript could not catch it: `const [row] = await query` is typed `T`, not
   * `T | undefined`, without `noUncheckedIndexedAccess`.
   *
   * The issued grant, when the final step completes one, is read through the grants
   * endpoints; the caller's own next step is driven by the returned `status`.
   */
  async approve(
    requestId: string,
    note: string | null,
    actor: { sub: string; email: string },
  ): Promise<AccessRequest> {
    const request = await this.getById(requestId);
    if (request.status !== 'pending') {
      throw new PreconditionFailedException(
        ErrorCodes.ACCESS_REQUEST_NOT_PENDING,
        'Only pending requests can be approved',
      );
    }

    if (request.requestId) {
      // Engine path: SoD + permission check + outbox handled by engine
      await this.engine.approve(request.requestId, note, actor);
    } else {
      // Legacy path for rows created before the engine was introduced
      const now = new Date();
      const grant = {
        id: newId(),
        requestId,
        granteeId: request.requesterId,
        accessType: request.accessType,
        target: request.target,
        grantedAt: now,
        expiresAt: new Date(now.getTime() + request.durationHours * MS_PER_HOUR),
      };
      await this.db.transaction(async (tx) => {
        await this.repo.approve(requestId, actor.sub, note, grant, tx);
        // Inside the transaction: an approval that issued a grant without recording it is
        // exactly the gap an access-request audit trail exists to close.
        await this.requestTrail.record(AUDIT_ACTION.ACCESS_REQUEST_APPROVED, requestId, actor, tx, {
          after: { grantId: grant.id, expiresAt: grant.expiresAt },
        });
      });
    }

    // Re-read rather than returning the pre-transition row: the engine may have advanced
    // the step, resolved the request, or issued a grant, and the caller needs the state
    // that actually resulted.
    return this.getById(requestId);
  }

  async reject(
    requestId: string,
    note: string | null,
    actor: { sub: string; email: string },
  ): Promise<AccessRequest> {
    const request = await this.getById(requestId);
    if (request.status !== 'pending') {
      throw new PreconditionFailedException(
        ErrorCodes.ACCESS_REQUEST_NOT_PENDING,
        'Only pending requests can be rejected',
      );
    }

    if (request.requestId) {
      await this.engine.reject(request.requestId, note, actor);
    } else {
      await this.db.transaction(async (tx) => {
        await this.repo.reject(requestId, actor.sub, note, tx);
        await this.requestTrail.record(AUDIT_ACTION.ACCESS_REQUEST_REJECTED, requestId, actor, tx, {
          before: { status: request.status },
          after: { status: 'rejected' },
        });
      });
    }

    return this.getById(requestId);
  }

  async revokeGrant(grantId: string, actor: { sub: string; email: string }): Promise<void> {
    const grant = await this.repo.findGrantById(grantId);
    if (!grant) throw new NotFoundException(ErrorCodes.ACCESS_GRANT_NOT_FOUND, 'Grant not found');
    if (grant.revokedAt) {
      throw new PreconditionFailedException(
        ErrorCodes.ACCESS_GRANT_NOT_ACTIVE,
        'Grant is already revoked',
      );
    }
    await this.db.transaction(async (tx) => {
      await this.repo.revokeGrant(grantId, tx);
      await this.grantTrail.record(AUDIT_ACTION.ACCESS_GRANT_REVOKED, grantId, actor, tx, {
        before: { granteeId: grant.granteeId, target: grant.target },
      });
    });
  }

  async listActiveGrants(granteeId: string): Promise<AccessGrant[]> {
    return this.repo.listActiveGrants(granteeId);
  }
}
