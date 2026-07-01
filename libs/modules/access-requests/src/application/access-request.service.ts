import { Inject, Injectable } from '@nestjs/common';
import {
  InjectDrizzle,
  type DrizzleDB,
  NotFoundException,
  ErrorCodes,
  PreconditionFailedException,
  RequestEngine,
} from '@platform';
import { AuditService } from '@modules/audit';
import { newId, MS_PER_HOUR } from '@shared-kernel';
import { desc, eq } from 'drizzle-orm';
import { accessGrants, accessRequests } from '../../../../../db/schema';
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

@Injectable()
export class AccessRequestService {
  constructor(
    @Inject(ACCESS_REQUEST_REPOSITORY) private readonly repo: IAccessRequestRepository,
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly engine: RequestEngine,
    private readonly audit: AuditService,
  ) {}

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

    // Backlink the engine request id into the domain row
    await this.db
      .update(accessRequests)
      .set({ requestId: engineItem.id })
      .where(eq(accessRequests.id, domainRow.id));

    await this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'access_request.submitted',
      resourceType: 'access_request',
      resourceId: domainRow.id,
      metadata: { accessType: input.accessType, target: input.target, engineRequestId: engineItem.id },
    });

    return { ...domainRow, requestId: engineItem.id };
  }

  async getById(id: string): Promise<AccessRequest> {
    const request = await this.repo.findById(id);
    if (!request) {
      throw new NotFoundException(ErrorCodes.ACCESS_REQUEST_NOT_FOUND, 'Access request not found');
    }
    return request;
  }

  async list(
    filters: AccessRequestFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: AccessRequest[]; total: number }> {
    return this.repo.list(filters, limit, offset);
  }

  async approve(
    requestId: string,
    note: string | null,
    actor: { sub: string; email: string },
  ): Promise<AccessGrant> {
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
        expiresAt: new Date(now.getTime() + Number(request.durationHours) * MS_PER_HOUR),
      };
      await this.db.transaction(async (tx) => {
        await this.repo.approve(requestId, actor.sub, note, grant, tx);
      });
      await this.audit.record({
        actorId: actor.sub,
        actorEmail: actor.email,
        action: 'access_request.approved',
        resourceType: 'access_request',
        resourceId: requestId,
      });
    }

    const [grantRow] = await this.db
      .select()
      .from(accessGrants)
      .where(eq(accessGrants.requestId, requestId))
      .orderBy(desc(accessGrants.grantedAt))
      .limit(1);

    return grantRow as AccessGrant;
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
      await this.repo.reject(requestId, actor.sub, note);
      await this.audit.record({
        actorId: actor.sub,
        actorEmail: actor.email,
        action: 'access_request.rejected',
        resourceType: 'access_request',
        resourceId: requestId,
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
    await this.repo.revokeGrant(grantId);
    await this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'access_grant.revoked',
      resourceType: 'access_grant',
      resourceId: grantId,
    });
  }

  async listActiveGrants(granteeId: string): Promise<AccessGrant[]> {
    return this.repo.listActiveGrants(granteeId);
  }
}
