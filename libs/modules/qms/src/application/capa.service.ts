import { Inject, Injectable } from '@nestjs/common';
import {
  ConflictException,
  ErrorCodes,
  InjectDrizzle,
  NotFoundException,
  PreconditionFailedException,
  type DrizzleDB,
} from '@platform';
import type { Actor } from '@shared-kernel';
import {
  AUDIT_ACTION,
  AUDIT_RESOURCE,
  AuditService,
  type ResourceAuditTrail,
} from '@modules/audit';
import {
  CAPA_REPOSITORY,
  NONCONFORMANCE_REPOSITORY,
  type ICapaRepository,
  type INonconformanceRepository,
} from '../domain/ports/qms.repository';
import { isSettledCapa } from '../infrastructure/persistence/capa.drizzle-repository';
import { isSettledNonconformance } from '../infrastructure/persistence/nonconformance.drizzle-repository';
import type {
  Capa,
  CapaAnalysisInput,
  CapaFilters,
  CapaStatus,
  OpenCapaInput,
} from '../domain/qms.types';

/**
 * The CAPA lifecycle, declared rather than spread through `if` statements.
 *
 * `ineffective → analysis` IS THE POINT. ISO 9001 §10.2(d) requires the effectiveness of corrective
 * action to be reviewed, which means the review can FAIL — and a process where failing it quietly
 * closes the record is the box-ticking the clause exists to prevent. So a failed review returns the
 * CAPA to analysis with its reason recorded, and the finding it belongs to stays open because no
 * verified CAPA exists.
 *
 * `verified` is terminal. A CAPA that needs revisiting after being signed off is a NEW CAPA against
 * the same finding — re-opening the old one would overwrite the evidence somebody relied on.
 */
const ALLOWED_TRANSITIONS: Record<CapaStatus, readonly CapaStatus[]> = {
  analysis: ['planned', 'cancelled'],
  planned: ['in_progress', 'cancelled'],
  in_progress: ['implemented', 'cancelled'],
  implemented: ['verified', 'ineffective', 'cancelled'],
  ineffective: ['analysis', 'cancelled'],
  verified: [],
  cancelled: [],
};

/**
 * Corrective and preventive actions: the analysis, the plan, and whether it worked.
 *
 * WHAT THIS SERVICE OWNS THAT THE DATABASE CANNOT
 *
 * 1. SEPARATION OF DUTIES ON THE REVIEW. The verifier may not be the CAPA's owner. A CHECK could
 *    compare the two columns, but the rule is about the ACTOR performing the transition and the owner
 *    can change between plan and review — so it is enforced here, against the token, and the route
 *    carries `capa.verify` on top.
 *
 * 2. THE ANALYSIS GATE. A CAPA cannot be planned without a root cause, the method that established
 *    it, and a plan. The CHECKs enforce the columns; this restates them as codes and refuses before
 *    any write, so a caller learns what is missing rather than receiving a 500.
 *
 * 3. THE LOOP. `ineffective` returns to `analysis`, which no CHECK can express because it cannot see
 *    the previous state.
 *
 * 4. A SETTLED CAPA ACCEPTS NOTHING NEW, and a CAPA cannot be opened against a settled finding —
 *    there is nothing left to correct, and one opened afterwards would never gate anything.
 */
@Injectable()
export class CapaService {
  private readonly trail: ResourceAuditTrail;

  constructor(
    @Inject(CAPA_REPOSITORY) private readonly repo: ICapaRepository,
    @Inject(NONCONFORMANCE_REPOSITORY) private readonly findings: INonconformanceRepository,
    @InjectDrizzle() private readonly db: DrizzleDB,
    audit: AuditService,
  ) {
    this.trail = audit.forResource(AUDIT_RESOURCE.CAPA);
  }

  // ── Opening ──────────────────────────────────────────────────────────────────

  async open(nonconformanceId: string, input: OpenCapaInput, actor: Actor): Promise<Capa> {
    const finding = await this.findings.findById(nonconformanceId);
    if (!finding) {
      throw new NotFoundException(
        ErrorCodes.NOT_FOUND,
        `Non-conformance ${nonconformanceId} not found`,
      );
    }
    if (isSettledNonconformance(finding.status)) {
      throw new PreconditionFailedException(
        ErrorCodes.NONCONFORMANCE_SETTLED,
        `${finding.reference} is '${finding.status}', so there is nothing left to correct`,
      );
    }
    if (await this.repo.findByReference(input.reference)) {
      throw new ConflictException(
        ErrorCodes.CONFLICT,
        `CAPA reference '${input.reference}' already exists`,
      );
    }

    return this.db.transaction(async (tx) => {
      const capa = await this.repo.create(nonconformanceId, input, tx);
      await this.trail.record(AUDIT_ACTION.CAPA_OPENED, capa.id, actor, tx, {
        after: {
          reference: capa.reference,
          nonconformanceId,
          nonconformanceReference: finding.reference,
          ownerId: capa.ownerId,
        },
      });
      return capa;
    });
  }

  async getById(id: string): Promise<Capa> {
    const capa = await this.repo.findById(id);
    if (!capa) throw new NotFoundException(ErrorCodes.NOT_FOUND, `CAPA ${id} not found`);
    return capa;
  }

  async list(filters: CapaFilters, limit: number, offset: number) {
    return this.repo.list(filters, limit, offset);
  }

  async listForNonconformance(nonconformanceId: string): Promise<Capa[]> {
    const finding = await this.findings.findById(nonconformanceId);
    if (!finding) {
      throw new NotFoundException(
        ErrorCodes.NOT_FOUND,
        `Non-conformance ${nonconformanceId} not found`,
      );
    }
    return this.repo.listForNonconformance(nonconformanceId);
  }

  // ── Analysis ─────────────────────────────────────────────────────────────────

  /**
   * Record the root cause, the method behind it, and the plan.
   *
   * Allowed in `analysis` only — including the `analysis` a failed review returned it to, which is
   * how a second attempt records a different cause without touching the first attempt's evidence.
   */
  async recordAnalysis(id: string, input: CapaAnalysisInput, actor: Actor): Promise<Capa> {
    const capa = await this.getById(id);
    this.assertNotSettled(capa);
    if (capa.status !== 'analysis') {
      throw new PreconditionFailedException(
        ErrorCodes.CAPA_NOT_IN_STATE,
        `${capa.reference} is '${capa.status}'. The analysis is recorded while it is 'analysis' — ` +
          'a failed effectiveness review returns it there.',
      );
    }

    return this.db.transaction(async (tx) => {
      const updated = await this.repo.setAnalysis(id, input, tx);
      await this.trail.record(AUDIT_ACTION.CAPA_ANALYSED, id, actor, tx, {
        after: { rootCauseMethod: input.rootCauseMethod, dueOn: updated!.dueOn },
      });
      return updated!;
    });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  /** Accept the plan. Refuses until the analysis is complete, before touching the row. */
  async plan(id: string, actor: Actor): Promise<Capa> {
    const capa = await this.getById(id);
    this.assertTransitionAllowed(capa, 'planned');
    this.assertAnalysisComplete(capa);
    return this.move(capa, 'planned', {}, AUDIT_ACTION.CAPA_PLANNED, actor, {});
  }

  async start(id: string, actor: Actor): Promise<Capa> {
    const capa = await this.getById(id);
    this.assertTransitionAllowed(capa, 'in_progress');
    return this.move(capa, 'in_progress', {}, AUDIT_ACTION.CAPA_STARTED, actor, {});
  }

  /** Record that the actions are done. Not that they worked — that is the review. */
  async markImplemented(
    id: string,
    implementedAt: string | undefined,
    actor: Actor,
  ): Promise<Capa> {
    const capa = await this.getById(id);
    this.assertTransitionAllowed(capa, 'implemented');
    const at = implementedAt ? new Date(implementedAt) : new Date();
    return this.move(
      capa,
      'implemented',
      { implementedAt: at },
      AUDIT_ACTION.CAPA_IMPLEMENTED,
      actor,
      {},
    );
  }

  /**
   * Sign off that the action WORKED — ISO 9001 §10.2(d).
   *
   * Refuses a verifier who owns the CAPA. The permission on the route says who may sign; this says
   * the signature has to come from somebody other than the author, which is the only thing that makes
   * it a review. Verifying is what unlocks closing a major finding, so this is the load-bearing
   * signature in the whole module.
   */
  async verify(id: string, evidence: string, actor: Actor): Promise<Capa> {
    const capa = await this.getById(id);
    this.assertTransitionAllowed(capa, 'verified');

    if (capa.ownerId === actor.sub) {
      throw new PreconditionFailedException(
        ErrorCodes.CAPA_SELF_VERIFICATION,
        `${capa.reference} is owned by you, so you cannot sign off its own effectiveness review — ` +
          'the review exists so that somebody other than the author agrees it worked',
      );
    }

    const at = new Date();
    if (capa.implementedAt && at.getTime() < capa.implementedAt.getTime()) {
      // `ck_capa_timeline_order` restated. Unreachable while the timestamp is `now()`, kept because
      // the day this method accepts a supplied date is the day it stops being unreachable.
      throw new PreconditionFailedException(
        ErrorCodes.CAPA_NOT_IN_STATE,
        'A CAPA cannot be verified before it was implemented',
      );
    }

    return this.move(
      capa,
      'verified',
      { verifiedAt: at, verifiedBy: actor.sub, effectivenessEvidence: evidence },
      AUDIT_ACTION.CAPA_VERIFIED,
      actor,
      {},
    );
  }

  /**
   * Record that the action did NOT work.
   *
   * Returns the CAPA to `analysis`, not to a terminal state: the finding it belongs to stays open
   * because no verified CAPA exists, and the next attempt records a different cause. This is the path
   * that makes the effectiveness review mean something.
   */
  async markIneffective(id: string, reason: string, actor: Actor): Promise<Capa> {
    const capa = await this.getById(id);
    this.assertTransitionAllowed(capa, 'ineffective');

    if (capa.ownerId === actor.sub) {
      // The same separation as `verify`. A review only counts as one if the author cannot decide the
      // answer — in either direction.
      throw new PreconditionFailedException(
        ErrorCodes.CAPA_SELF_VERIFICATION,
        `${capa.reference} is owned by you, so you cannot rule on its own effectiveness review`,
      );
    }

    return this.move(
      capa,
      'ineffective',
      { outcomeNote: reason },
      AUDIT_ACTION.CAPA_INEFFECTIVE,
      actor,
      { reason },
    );
  }

  /** Return a failed CAPA to analysis so a different cause can be recorded. */
  async reopenAnalysis(id: string, actor: Actor): Promise<Capa> {
    const capa = await this.getById(id);
    this.assertTransitionAllowed(capa, 'analysis');
    return this.move(capa, 'analysis', {}, AUDIT_ACTION.CAPA_ANALYSED, actor, {
      returnedFrom: capa.status,
    });
  }

  async cancel(id: string, reason: string, actor: Actor): Promise<Capa> {
    const capa = await this.getById(id);
    this.assertTransitionAllowed(capa, 'cancelled');
    return this.move(
      capa,
      'cancelled',
      { outcomeNote: reason },
      AUDIT_ACTION.CAPA_CANCELLED,
      actor,
      { reason },
    );
  }

  // ── Shared internals ─────────────────────────────────────────────────────────

  private async move(
    capa: Capa,
    to: CapaStatus,
    extra: Parameters<ICapaRepository['transition']>[3],
    action: (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION],
    actor: Actor,
    metadata: Record<string, unknown>,
  ): Promise<Capa> {
    const from = capa.status;

    return this.db.transaction(async (tx) => {
      const moved = await this.repo.transition(capa.id, from, to, extra, tx);
      if (!moved) {
        throw new ConflictException(
          ErrorCodes.CAPA_NOT_IN_STATE,
          `${capa.reference} was no longer '${from}' — read it again and retry`,
        );
      }
      await this.trail.record(action, capa.id, actor, tx, {
        before: { status: from },
        after: { status: to, ...metadata },
      });
      return moved;
    });
  }

  private assertTransitionAllowed(capa: Capa, to: CapaStatus): void {
    if (!ALLOWED_TRANSITIONS[capa.status].includes(to)) {
      const legal = ALLOWED_TRANSITIONS[capa.status];
      throw new PreconditionFailedException(
        ErrorCodes.CAPA_NOT_IN_STATE,
        `${capa.reference} is '${capa.status}', which cannot become '${to}'. ` +
          (legal.length === 0
            ? 'That status is terminal — open a new CAPA against the finding instead.'
            : `Legal next states: ${legal.join(', ')}.`),
      );
    }
  }

  /** `ck_capa_root_cause_states` and `ck_capa_plan_states` in words, named field by field. */
  private assertAnalysisComplete(capa: Capa): void {
    const missing: string[] = [];
    if ((capa.rootCause ?? '').trim().length < 10) missing.push('a root cause');
    if (!capa.rootCauseMethod) missing.push('the method it was established by');
    if ((capa.actionPlan ?? '').trim().length < 10) missing.push('an action plan');
    if (missing.length > 0) {
      throw new PreconditionFailedException(
        ErrorCodes.CAPA_ANALYSIS_INCOMPLETE,
        `${capa.reference} cannot be planned without ${missing.join(', ')} — a plan built on no ` +
          'stated cause is a guess',
      );
    }
  }

  private assertNotSettled(capa: Capa): void {
    if (isSettledCapa(capa.status)) {
      throw new PreconditionFailedException(
        ErrorCodes.CAPA_SETTLED,
        `${capa.reference} is '${capa.status}' and accepts no further changes`,
      );
    }
  }
}

export { ALLOWED_TRANSITIONS as CAPA_TRANSITIONS };
