import { Injectable, OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { type DbExecutor, RequestRegistry, RequestTypeDef } from '@platform';
import { REQUEST_TYPE } from '@shared-kernel';
import { leaveRequests } from '../../../../../db/schema';

export interface LeaveRequestPayload extends Record<string, unknown> {
  leaveRequestId: string;
  employeeId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string | null;
}

/**
 * RequestTypeDef for leave requests. Syncs the domain-table status when the
 * engine transitions state, so existing queries against `workforce.leave_requests`
 * continue to work unchanged.
 */
@Injectable()
export class LeaveRequestTypeDef
  implements RequestTypeDef<LeaveRequestPayload>, OnModuleInit
{
  readonly type = REQUEST_TYPE.LEAVE_REQUEST;
  readonly requiredApprovalPermission = 'workforce.leave.review';
  readonly allowSelfApproval = false;
  readonly defaultExpiryHours = 72; // 3 days
  /** SLA: notify if not approved within 48 h (2 business days) */
  readonly slaHours = 48;

  constructor(private readonly registry: RequestRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async onApprove(
    payload: LeaveRequestPayload,
    _requestId: string,
    reviewerId: string,
    tx: DbExecutor,
  ): Promise<void> {
    const now = new Date();
    await tx
      .update(leaveRequests)
      .set({ status: 'approved', reviewerId, reviewedAt: now })
      .where(eq(leaveRequests.id, payload.leaveRequestId));
  }

  async onReject(
    payload: LeaveRequestPayload,
    _requestId: string,
    reviewerId: string,
    tx: DbExecutor,
  ): Promise<void> {
    const now = new Date();
    await tx
      .update(leaveRequests)
      .set({ status: 'rejected', reviewerId, reviewedAt: now })
      .where(eq(leaveRequests.id, payload.leaveRequestId));
  }

  async onExpire(payload: LeaveRequestPayload, _requestId: string, tx: DbExecutor): Promise<void> {
    await tx
      .update(leaveRequests)
      .set({ status: 'cancelled' })
      .where(eq(leaveRequests.id, payload.leaveRequestId));
  }
}
