import { Injectable, OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { type DbExecutor, RequestRegistry, RequestTypeDef } from '@platform';
import { REQUEST_TYPE } from '@shared-kernel';
import { overtimeEntries } from '../../../../../db/schema';

export interface OvertimePayload extends Record<string, unknown> {
  overtimeId: string;
  employeeId: string;
  workDate: string;
  hours: number;
  reason: string;
}

/**
 * RequestTypeDef for overtime entries. Syncs the domain-table status when the
 * engine transitions state.
 */
@Injectable()
export class OvertimeTypeDef
  implements RequestTypeDef<OvertimePayload>, OnModuleInit
{
  readonly type = REQUEST_TYPE.OVERTIME;
  readonly requiredApprovalPermission = 'workforce.overtime.review';
  readonly allowSelfApproval = false;
  readonly defaultExpiryHours = 72; // 3 days
  /** SLA: notify if not approved within 48 h (2 business days) */
  readonly slaHours = 48;

  constructor(private readonly registry: RequestRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async onApprove(
    payload: OvertimePayload,
    _requestId: string,
    reviewerId: string,
    tx: DbExecutor,
  ): Promise<void> {
    const now = new Date();
    await tx
      .update(overtimeEntries)
      .set({ status: 'approved', reviewerId, reviewedAt: now })
      .where(eq(overtimeEntries.id, payload.overtimeId));
  }

  async onReject(
    payload: OvertimePayload,
    _requestId: string,
    reviewerId: string,
    tx: DbExecutor,
  ): Promise<void> {
    const now = new Date();
    await tx
      .update(overtimeEntries)
      .set({ status: 'rejected', reviewerId, reviewedAt: now })
      .where(eq(overtimeEntries.id, payload.overtimeId));
  }

  async onExpire(payload: OvertimePayload, _requestId: string, tx: DbExecutor): Promise<void> {
    await tx
      .update(overtimeEntries)
      .set({ status: 'rejected' })
      .where(eq(overtimeEntries.id, payload.overtimeId));
  }
}
