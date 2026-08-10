import { Inject, Injectable, OnModuleInit, forwardRef } from '@nestjs/common';
import { RequestRegistry, type DbExecutor, type RequestTypeDef } from '@platform';
import { REQUEST_TYPE } from '@shared-kernel';
import { RISK_REPOSITORY, type IRiskRepository } from '../domain/ports/risk.repository';
import { RiskService } from './risk.service';

export interface RiskAcceptancePayload extends Record<string, unknown> {
  riskId: string;
  riskReference: string;
  riskTitle: string;
  /** Frozen at submission: the number the approver is actually signing off. */
  residualScore: number;
  justification: string;
  reviewDueOn: string | null;
}

/**
 * Sign-off for accepting a residual risk, as a `RequestTypeDef` rather than a status column.
 *
 * Accepting risk is the one ISMS decision that creates exposure by choice, so ISO 27001 asks for a
 * named accountable approver and a recorded basis. That is an approval — the same shape as a
 * document approval or an access request — so it reuses the engine's separation of duties,
 * delegation, SLA and audit entry instead of this module reimplementing them.
 *
 * `residualScore` IS IN THE PAYLOAD, deliberately, rather than read from the risk at approval time.
 * The approver is agreeing to carry a specific exposure; if somebody re-scores the risk while the
 * request is open, the number that was approved must remain the number that was shown. The current
 * score is still visible on the risk itself, which is where a reviewer would look to notice the
 * difference.
 *
 * NO AUTO-EXPIRY. An un-actioned acceptance request means the risk is still untreated and still
 * open — a standing obligation, not a request that goes stale. Letting it expire would quietly
 * remove the prompt while leaving the exposure.
 *
 * NO `onReject` EITHER, and that is not an omission: the risk is never moved at submission, so a
 * refusal leaves it exactly where it was — assessed or treated, and still open. A no-op hook would
 * only invite somebody to assume there is state to unwind.
 */
@Injectable()
export class RiskAcceptanceTypeDef implements RequestTypeDef<RiskAcceptancePayload>, OnModuleInit {
  readonly type = REQUEST_TYPE.RISK_ACCEPTANCE;
  /**
   * Deliberately NOT `risk.manage`: the person who assessed a risk should not be the person who
   * signs off carrying it. `risk.accept` is held by a different role for exactly that reason.
   */
  readonly requiredApprovalPermission = 'risk.accept';
  /** The engine's default, and the whole point here — you may not accept your own assessment. */
  readonly allowSelfApproval = false;
  readonly defaultExpiryHours = 0;
  readonly slaHours = 120;

  constructor(
    private readonly registry: RequestRegistry,
    @Inject(RISK_REPOSITORY) private readonly repo: IRiskRepository,
    // Circular by construction: the service submits the request, and this definition calls back into
    // the service to apply the outcome. `forwardRef` is Nest's answer, and the alternative — a second
    // copy of the acceptance write here — is how the two paths drift on which columns acceptance
    // sets.
    @Inject(forwardRef(() => RiskService)) private readonly risks: RiskService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async onApprove(
    payload: RiskAcceptancePayload,
    requestId: string,
    approverId: string,
    tx: DbExecutor,
  ): Promise<void> {
    // Read inside the engine's transaction: the risk may have moved since submission, and
    // `applyAcceptance` guards the FROM state in its WHERE clause.
    const risk = await this.repo.findById(payload.riskId, tx);
    if (!risk) return;

    await this.risks.applyAcceptance(
      risk,
      {
        approverId,
        justification: payload.justification,
        reviewDueOn: payload.reviewDueOn,
        requestId,
      },
      /*
       * The APPROVER is the actor on the audit entry: they are the one accepting the exposure, and
       * an entry naming the requester would misattribute the decision.
       *
       * The engine hands `onApprove` an id and no email, and `AuditService` records both. Rather
       * than a second lookup for a display string that the id already resolves to, the entry
       * carries the id in both fields — visibly derived rather than silently blank.
       */
      { sub: approverId, email: approverId },
      tx,
    );
  }
}
