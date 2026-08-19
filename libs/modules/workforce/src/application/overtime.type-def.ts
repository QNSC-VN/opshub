import { Injectable, OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { type DbExecutor, RequestRegistry, RequestTypeDef } from '@platform';
import { AUDIT_ACTION, AUDIT_RESOURCE, AuditService } from '@modules/audit';
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
 *
 * AND RECORDS THE DECISION, which nothing did — see `LeaveRequestTypeDef` for the full account. The
 * short version: `RequestEngine` audits no transition, these hooks wrote the status and stopped, and
 * the only `overtime.approved` / `overtime.rejected` writes lived in an unreachable legacy branch of
 * `WorkforceService.reviewOvertime`. Overtime is paid work, so an approval with no record is a payment
 * with no authorisation attached to it.
 */
@Injectable()
export class OvertimeTypeDef implements RequestTypeDef<OvertimePayload>, OnModuleInit {
  readonly type = REQUEST_TYPE.OVERTIME;
  readonly requiredApprovalPermission = 'workforce.overtime.review';
  readonly allowSelfApproval = false;
  readonly defaultExpiryHours = 72; // 3 days
  /** SLA: notify if not approved within 48 h (2 business days) */
  readonly slaHours = 48;

  private readonly trail;

  constructor(
    private readonly registry: RequestRegistry,
    private readonly audit: AuditService,
  ) {
    this.trail = audit.forResource(AUDIT_RESOURCE.OVERTIME_ENTRY);
  }

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

    // `hours` is on the entry because it is what was authorised. An approval record that does not say
    // how much overtime it approved cannot be reconciled against what was paid.
    await this.trail.record(
      AUDIT_ACTION.OVERTIME_APPROVED,
      payload.overtimeId,
      { sub: reviewerId, email: reviewerId },
      tx,
      {
        before: { status: 'pending' },
        after: { status: 'approved', reviewedAt: now, hours: payload.hours },
      },
    );
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

    await this.trail.record(
      AUDIT_ACTION.OVERTIME_REJECTED,
      payload.overtimeId,
      { sub: reviewerId, email: reviewerId },
      tx,
      { before: { status: 'pending' }, after: { status: 'rejected', reviewedAt: now } },
    );
  }

  async onExpire(payload: OvertimePayload, _requestId: string, tx: DbExecutor): Promise<void> {
    await tx
      .update(overtimeEntries)
      .set({ status: 'rejected' })
      .where(eq(overtimeEntries.id, payload.overtimeId));

    /*
     * NO ACTOR — time did this, not a person. Same convention as `ContractExpiryCron`.
     *
     * Expiry writes `rejected`, the SAME status an approver's refusal writes, so without `reason` on
     * the entry the trail cannot tell "your manager said no" from "nobody looked at it for three
     * days". For unpaid work already done, those are not the same answer.
     */
    await this.audit.record(
      {
        actorId: null,
        actorEmail: null,
        action: AUDIT_ACTION.OVERTIME_REJECTED,
        resourceType: AUDIT_RESOURCE.OVERTIME_ENTRY,
        resourceId: payload.overtimeId,
        changes: {
          before: { status: 'pending' },
          after: { status: 'rejected', reason: 'expired without review' },
        },
      },
      tx,
    );
  }
}
