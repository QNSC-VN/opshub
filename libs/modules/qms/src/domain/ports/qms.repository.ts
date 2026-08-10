import type { DbExecutor } from '@platform';
import type {
  Capa,
  CapaAnalysisInput,
  CapaFilters,
  CapaRow,
  ContainmentOverdue,
  Nonconformance,
  NonconformanceFilters,
  NonconformanceRow,
  NonconformanceSeverityLevel,
  OpenCapaInput,
  RaiseNonconformanceInput,
  RecurrenceSignal,
  UpdateNonconformanceInput,
} from '../qms.types';
import type {
  AuditFinding,
  AuditRole,
  InternalAudit,
  InternalAuditAuditor,
  InternalAuditFilters,
  InternalAuditRow,
  PlanAuditInput,
  UnlinkedFinding,
  UpdateAuditInput,
} from '../internal-audit.types';

export const NONCONFORMANCE_REPOSITORY = Symbol('NONCONFORMANCE_REPOSITORY');
export const CAPA_REPOSITORY = Symbol('CAPA_REPOSITORY');

export interface INonconformanceRepository {
  /**
   * The severity grades with their ranks and the policy each carries.
   *
   * THE ONLY SOURCE OF BOTH. Nothing hard-codes the ordering, and nothing hard-codes whether a grade
   * demands a CAPA — the closure gate reads `requiresCapa` from here, so a policy change is an
   * UPDATE to one table rather than an edit to the service.
   */
  listSeverities(): Promise<NonconformanceSeverityLevel[]>;

  create(
    input: RaiseNonconformanceInput & { raisedBy: string },
    tx?: DbExecutor,
  ): Promise<Nonconformance>;
  findById(id: string, tx?: DbExecutor): Promise<Nonconformance | null>;
  findByReference(reference: string): Promise<Nonconformance | null>;
  list(
    filters: NonconformanceFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: NonconformanceRow[]; total: number }>;
  update(
    id: string,
    input: UpdateNonconformanceInput,
    tx?: DbExecutor,
  ): Promise<Nonconformance | null>;

  /**
   * Move the finding's status, guarding the FROM state in the WHERE clause.
   *
   * Returns null when the row was not in `from` — which makes the transition atomic rather than a
   * read-then-write two people can both pass while closing the same finding.
   */
  transition(
    id: string,
    from: Nonconformance['status'],
    to: Nonconformance['status'],
    extra: Partial<
      Pick<
        Nonconformance,
        'containmentAction' | 'containedAt' | 'closedAt' | 'closureNote' | 'closedBy' | 'voidReason'
      >
    >,
    tx?: DbExecutor,
  ): Promise<Nonconformance | null>;

  // ── Reports ────────────────────────────────────────────────────────────────
  /** Findings past the containment deadline their grade allows. */
  containmentOverdue(limit: number): Promise<ContainmentOverdue[]>;
  /** Process areas where findings recur despite a CAPA already verified effective. */
  recurrenceSignals(limit: number): Promise<RecurrenceSignal[]>;
}

export interface ICapaRepository {
  create(nonconformanceId: string, input: OpenCapaInput, tx?: DbExecutor): Promise<Capa>;
  findById(id: string, tx?: DbExecutor): Promise<Capa | null>;
  findByReference(reference: string): Promise<Capa | null>;
  list(
    filters: CapaFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: CapaRow[]; total: number }>;
  listForNonconformance(nonconformanceId: string): Promise<Capa[]>;

  /** Record the analysis. Separate from `transition` because it writes fields, not a state. */
  setAnalysis(id: string, input: CapaAnalysisInput, tx?: DbExecutor): Promise<Capa | null>;

  /** Move the CAPA's status, guarding the FROM state — same reasoning as above. */
  transition(
    id: string,
    from: Capa['status'],
    to: Capa['status'],
    extra: Partial<
      Pick<
        Capa,
        'implementedAt' | 'verifiedAt' | 'verifiedBy' | 'effectivenessEvidence' | 'outcomeNote'
      >
    >,
    tx?: DbExecutor,
  ): Promise<Capa | null>;

  /**
   * Whether this finding has a CAPA verified effective.
   *
   * The closure gate's question, asked as a count rather than by pulling every CAPA: the gate needs
   * one bit and the register list needs the counts, so neither reads the other's rows.
   */
  hasVerifiedCapa(nonconformanceId: string, tx?: DbExecutor): Promise<boolean>;
}

export const INTERNAL_AUDIT_REPOSITORY = Symbol('INTERNAL_AUDIT_REPOSITORY');

export interface IInternalAuditRepository {
  create(input: PlanAuditInput, tx?: DbExecutor): Promise<InternalAudit>;
  findById(id: string, tx?: DbExecutor): Promise<InternalAudit | null>;
  findByReference(reference: string): Promise<InternalAudit | null>;
  list(
    filters: InternalAuditFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: InternalAuditRow[]; total: number }>;
  update(id: string, input: UpdateAuditInput, tx?: DbExecutor): Promise<InternalAudit | null>;

  /** Move the audit's status, guarding the FROM state — same reasoning as the other registers. */
  transition(
    id: string,
    from: InternalAudit['status'],
    to: InternalAudit['status'],
    extra: Partial<
      Pick<
        InternalAudit,
        'startedAt' | 'reportedAt' | 'conclusion' | 'reportDocumentId' | 'closedAt' | 'cancelReason'
      >
    >,
    tx?: DbExecutor,
  ): Promise<InternalAudit | null>;

  // ── The roster ─────────────────────────────────────────────────────────────
  /** Add or re-role somebody. Idempotent on the pair, so re-adding changes the role. */
  upsertAuditor(
    internalAuditId: string,
    auditorId: string,
    role: AuditRole,
    addedBy: string,
    tx?: DbExecutor,
  ): Promise<void>;
  removeAuditor(internalAuditId: string, auditorId: string, tx?: DbExecutor): Promise<boolean>;
  listAuditors(internalAuditId: string): Promise<InternalAuditAuditor[]>;
  /**
   * Whether this person AUDITED on this audit — `lead` or `auditor`, never `observer`.
   *
   * The impartiality question, asked as a boolean. `CapaService` reads it to refuse an effectiveness
   * review signed by somebody who audited the finding being corrected (§9.2.2(c)). An observer is
   * deliberately not an auditor here: sitting in on fieldwork does not compromise a later review.
   */
  didAudit(internalAuditId: string, personId: string, tx?: DbExecutor): Promise<boolean>;

  // ── Findings ───────────────────────────────────────────────────────────────
  /** Findings raised against this audit, worst grade first. */
  listFindings(internalAuditId: string): Promise<AuditFinding[]>;
  /** `internal_audit` findings that name no audit — the traceability gap. */
  unlinkedFindings(limit: number): Promise<UnlinkedFinding[]>;
}
