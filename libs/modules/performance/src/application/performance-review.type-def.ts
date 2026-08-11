import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  ErrorCodes,
  PreconditionFailedException,
  RequestRegistry,
  RequestTypeDef,
  type DbExecutor,
} from '@platform';
import { REQUEST_TYPE } from '@shared-kernel';
import { PERMISSION } from '@db/permissions.catalog';
import { PerformanceService } from './performance.service';
import type { PerformanceRating } from '../domain/performance.types';

export interface PerformanceReviewPayload extends Record<string, unknown> {
  reviewId: string;
  cycleId: string;
  employeeId: string;
  reviewerId: string;
  /** Carried so an approver sees WHAT they are signing off without opening the review. */
  overallRating: PerformanceRating;
}

/**
 * Calibration sign-off on a performance rating — the request engine's, not a second approver column.
 *
 * WHY THE ENGINE. An approval is an approval: separation of duties, the SLA clock, expiry, the audit
 * entry, the notification and the "my approvals" queue all already exist and are tested. A bespoke
 * `approved_by` with its own permission check would reimplement five of those and get the sixth
 * wrong.
 *
 * TWO PEOPLE ARE EXCLUDED, FOR DIFFERENT REASONS.
 *
 *   * THE REVIEWER, by `allowSelfApproval: false`. They submitted it, and a manager who could rate
 *     and then approve would make calibration a formality.
 *   * THE EMPLOYEE, by the check in {@link onApprove}. The engine has no idea a request has a
 *     SUBJECT — that is domain knowledge — so without this, anybody holding `performance.approve`
 *     could approve the review of themselves. Enforced inside the approval transaction, which is
 *     both where the approver is known and where the refusal can still stop the state change.
 *
 * A REJECTION RETURNS THE REVIEW TO THE REVIEWER rather than cancelling it, and the rating stays on
 * the row: it is precisely what was rejected, and clearing it would lose the thing that has to
 * change. Expiry does the same, because an approver who never got to it has not decided anything.
 */
@Injectable()
export class PerformanceReviewTypeDef
  implements RequestTypeDef<PerformanceReviewPayload>, OnModuleInit
{
  readonly type = REQUEST_TYPE.PERFORMANCE_REVIEW;
  readonly requiredApprovalPermission = PERMISSION.PERFORMANCE_APPROVE;
  readonly allowSelfApproval = false;
  /** Two weeks: a calibration round is a scheduled meeting, not a same-day decision. */
  readonly defaultExpiryHours = 14 * 24;
  /** Nudge after five working days, well before expiry, since the review is blocking the employee. */
  readonly slaHours = 5 * 24;

  constructor(
    private readonly registry: RequestRegistry,
    private readonly performance: PerformanceService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async onApprove(
    payload: PerformanceReviewPayload,
    _requestId: string,
    approverId: string,
    tx: DbExecutor,
  ): Promise<void> {
    if (approverId === payload.employeeId) {
      throw new PreconditionFailedException(
        ErrorCodes.PERFORMANCE_EMPLOYEE_APPROVAL,
        'A review cannot be signed off by the person it is about, whatever permissions they hold',
      );
    }
    await this.performance.applyApproval(payload.reviewId, approverId, tx);
  }

  async onReject(
    payload: PerformanceReviewPayload,
    _requestId: string,
    reviewerId: string,
    tx: DbExecutor,
  ): Promise<void> {
    await this.performance.applyReturn(payload.reviewId, reviewerId, 'rejected', tx);
  }

  async onExpire(
    payload: PerformanceReviewPayload,
    _requestId: string,
    tx: DbExecutor,
  ): Promise<void> {
    // Attributed to the reviewer: nobody decided, and the review is back on their desk.
    await this.performance.applyReturn(payload.reviewId, payload.reviewerId, 'expired', tx);
  }
}
