import type { DbExecutor } from '@platform';
import type {
  AddTreatmentInput,
  IdentifyRiskInput,
  Risk,
  RiskFilters,
  RiskTreatment,
  UpdateRiskInput,
  UpdateTreatmentInput,
} from '../risk.types';

export const RISK_REPOSITORY = Symbol('RISK_REPOSITORY');

export interface IRiskRepository {
  // ── Risks ──────────────────────────────────────────────────────────────────
  create(input: IdentifyRiskInput, tx?: DbExecutor): Promise<Risk>;
  findById(id: string, tx?: DbExecutor): Promise<Risk | null>;
  findByReference(reference: string): Promise<Risk | null>;
  list(
    filters: RiskFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: Risk[]; total: number }>;
  update(id: string, input: UpdateRiskInput, tx?: DbExecutor): Promise<Risk | null>;
  /**
   * Move a risk's status, guarding the FROM state in the WHERE clause.
   *
   * Returns null when the row was not in `from` — which is what makes the transition atomic rather
   * than a read-then-write that two callers can both pass.
   */
  transition(
    id: string,
    from: Risk['status'],
    to: Risk['status'],
    extra: Partial<
      Pick<
        Risk,
        | 'treatmentDecision'
        | 'residualLikelihood'
        | 'residualImpact'
        | 'acceptedBy'
        | 'acceptedAt'
        | 'acceptanceJustification'
        | 'acceptedViaRequestId'
        | 'closedAt'
        | 'closureNote'
        | 'reviewDueOn'
      >
    >,
    tx?: DbExecutor,
  ): Promise<Risk | null>;

  // ── Treatments ─────────────────────────────────────────────────────────────
  addTreatment(input: AddTreatmentInput, tx?: DbExecutor): Promise<RiskTreatment>;
  findTreatmentById(id: string, tx?: DbExecutor): Promise<RiskTreatment | null>;
  listTreatments(riskId: string): Promise<RiskTreatment[]>;
  updateTreatment(
    id: string,
    input: UpdateTreatmentInput,
    tx?: DbExecutor,
  ): Promise<RiskTreatment | null>;
  /**
   * Treatments still to do for a risk.
   *
   * Takes `tx` because "may this risk be marked treated?" is answered inside the transition's
   * transaction — read on the pool and a treatment cancelled concurrently could let a risk be
   * declared treated with work still outstanding.
   */
  countOutstandingTreatments(riskId: string, tx?: DbExecutor): Promise<number>;
}
