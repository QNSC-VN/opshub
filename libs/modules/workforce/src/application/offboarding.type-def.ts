import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { type DbExecutor, InjectDrizzle, type DrizzleDB, RequestRegistry, RequestTypeDef } from '@platform';
import { REQUEST_TYPE } from '@shared-kernel';
import {
  employees,
  userRoleAssignments,
  accessGrants,
  assetAssignments,
  assets,
  refreshTokens,
} from '../../../../../db/schema';
import { GraphProvisioningService } from './graph-provisioning.service';

export interface OffboardingPayload extends Record<string, unknown> {
  /** The employee being offboarded. */
  employeeId: string;
  employeeEmail: string;
  reason?: string;
}

/**
 * Single-step offboarding workflow (HR approves).
 *
 * `onApprove` atomically:
 *   1. Sets employee status → `offboarded`
 *   2. Removes all RBAC role assignments
 *   3. Revokes all active access grants
 *   4. Returns all assigned hardware assets (sets returnedAt, status → in_stock)
 *   5. Revokes all active refresh tokens (forces immediate logout)
 *
 * All five operations share the same transaction, so either all succeed or none do.
 */
@Injectable()
export class OffboardingTypeDef
  implements RequestTypeDef<OffboardingPayload>, OnModuleInit
{
  private readonly logger = new Logger(OffboardingTypeDef.name);

  readonly type = REQUEST_TYPE.OFFBOARDING;
  readonly requiredApprovalPermission = 'offboarding.approve';
  readonly allowSelfApproval = false;
  readonly defaultExpiryHours = 72; // 3 days
  readonly slaHours = 24; // same-day SLA for security

  constructor(
    private readonly registry: RequestRegistry,
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly graphProvisioning: GraphProvisioningService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async onApprove(
    payload: OffboardingPayload,
    _requestId: string,
    _approverId: string,
    tx: DbExecutor,
  ): Promise<void> {
    const now = new Date();
    const { employeeId } = payload;

    // 1. Mark employee as offboarded
    await tx
      .update(employees)
      .set({ status: 'offboarded', updatedAt: now })
      .where(eq(employees.id, employeeId));

    // 2. Remove all RBAC role assignments
    await tx
      .delete(userRoleAssignments)
      .where(eq(userRoleAssignments.userId, employeeId));

    // 3. Revoke all active access grants
    await tx
      .update(accessGrants)
      .set({ revokedAt: now })
      .where(and(eq(accessGrants.granteeId, employeeId), isNull(accessGrants.revokedAt)));

    // 4. Return all active asset assignments + reset asset status to in_stock
    const activeAssignments = await tx
      .update(assetAssignments)
      .set({ returnedAt: now })
      .where(and(eq(assetAssignments.employeeId, employeeId), isNull(assetAssignments.returnedAt)))
      .returning({ assetId: assetAssignments.assetId });

    if (activeAssignments.length > 0) {
      const assetIds = activeAssignments.map((a) => a.assetId);
      for (const assetId of assetIds) {
        await tx
          .update(assets)
          .set({ status: 'in_stock', updatedAt: now })
          .where(eq(assets.id, assetId));
      }
    }

    // 5. Revoke all refresh tokens (forces immediate logout across all sessions)
    await tx
      .update(refreshTokens)
      .set({ revoked: true })
      .where(and(eq(refreshTokens.employeeId, employeeId), eq(refreshTokens.revoked, false)));
  }

  async onReject(
    _payload: OffboardingPayload,
    _requestId: string,
    _approverId: string,
    _tx: DbExecutor,
  ): Promise<void> {
    // Nothing to undo — no domain state was changed on submit.
  }

  async afterApprove(payload: OffboardingPayload): Promise<void> {
    if (!this.graphProvisioning.isEnabled()) return;

    const [row] = await this.db
      .select({ entraOid: employees.entraOid })
      .from(employees)
      .where(eq(employees.id, payload.employeeId))
      .limit(1);

    if (!row?.entraOid) {
      this.logger.warn(`Offboarding afterApprove: no Entra OID for employee ${payload.employeeId}, skipping Graph disable`);
      return;
    }

    await this.graphProvisioning.disableEntraUser(row.entraOid);
  }
}
