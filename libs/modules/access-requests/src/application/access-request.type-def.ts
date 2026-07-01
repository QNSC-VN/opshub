import { Injectable, OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  type DbExecutor,
  RequestRegistry,
  RequestTypeDef,
  type ApprovalStepDef,
  NotificationSchedulerService,
} from '@platform';
import { newId, REQUEST_TYPE } from '@shared-kernel';
import { accessRequests, accessGrants } from '../../../../../db/schema';

export interface AccessRequestPayload extends Record<string, unknown> {
  accessRequestId: string;
  /** Copied from engine requestItem.requesterId at submit time — avoids a SELECT inside the approval tx. */
  requesterId: string;
  accessType: string;
  target: string;
  justification: string;
  durationHours: number;
}

/**
 * RequestTypeDef for privileged-access requests. Registered in the engine
 * on module init so the unified inbox + PolicyGuard know how to handle it.
 *
 * `onApprove` creates the `access_grants` row and syncs the domain-table status.
 * `onReject` / `onExpire` sync the domain-table status for backwards-compat queries.
 */
@Injectable()
export class AccessRequestTypeDef
  implements RequestTypeDef<AccessRequestPayload>, OnModuleInit
{
  readonly type = REQUEST_TYPE.ACCESS_REQUEST;
  /**
   * Fallback for single-step mode (backward compat). When `approvalSteps` is
   * defined, the engine uses per-step permissions instead.
   */
  readonly requiredApprovalPermission = 'access_request.approve';
  readonly allowSelfApproval = false;
  readonly defaultExpiryHours = 168; // 7 days
  /** SLA: notify if not approved within 72 h (3 business days) */
  readonly slaHours = 72;

  /**
   * Two-step approval chain:
   *   Step 1 — Line manager / access approver (`access_request.approve`)
   *   Step 2 — IT Security reviewer (`access_request.security_approve`)
   *
   * The engine handles state transitions and assignee updates between steps.
   * `onApprove` (called only on step-2 final approval) creates the access grant.
   */
  readonly approvalSteps: ApprovalStepDef[] = [
    { step: 1, requiredPermission: 'access_request.approve' },
    { step: 2, requiredPermission: 'access_request.security_approve' },
  ];

  constructor(
    private readonly registry: RequestRegistry,
    private readonly notifScheduler: NotificationSchedulerService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * Called when step 1 completes (manager approved).
   * Notifies the requester that step 1 is done and IT Security review is pending.
   */
  async onStepApproved(
    payload: AccessRequestPayload,
    requestId: string,
    completedStep: number,
    _nextStep: number,
    _nextAssigneeId: string | null,
    _approverId: string,
    tx: DbExecutor,
  ): Promise<void> {
    // Notify the requester that step 1 passed
    await this.notifScheduler.schedule(tx, {
      type: 'access_request.submitted', // reuse "pending" template as "still in review"
      vars: {
        resourceName: String(payload.target),
        requesterName: String(payload.requesterId),
      },
      recipientId: payload.requesterId,
      resourceId: requestId,
      idempotencyKey: `ar_step${completedStep}_notify:${requestId}`,
    });
  }

  async onApprove(
    payload: AccessRequestPayload,
    _requestId: string,
    approverId: string,
    tx: DbExecutor,
  ): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + payload.durationHours * 3_600_000);

    await tx
      .update(accessRequests)
      .set({ status: 'approved', reviewerId: approverId, reviewedAt: now, updatedAt: now })
      .where(eq(accessRequests.id, payload.accessRequestId));

    await tx.insert(accessGrants).values({
      id: newId(),
      requestId: payload.accessRequestId,
      granteeId: payload.requesterId,
      accessType: payload.accessType as typeof accessGrants.$inferInsert['accessType'],
      target: payload.target,
      grantedAt: now,
      expiresAt,
    });
  }

  async onReject(
    payload: AccessRequestPayload,
    _requestId: string,
    approverId: string,
    tx: DbExecutor,
  ): Promise<void> {
    const now = new Date();
    await tx
      .update(accessRequests)
      .set({ status: 'rejected', reviewerId: approverId, reviewedAt: now, updatedAt: now })
      .where(eq(accessRequests.id, payload.accessRequestId));
  }

  async onExpire(payload: AccessRequestPayload, _requestId: string, tx: DbExecutor): Promise<void> {
    await tx
      .update(accessRequests)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(eq(accessRequests.id, payload.accessRequestId));
  }
}
