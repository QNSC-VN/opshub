import type { DbExecutor } from '@platform';
import type {
  Control,
  ControlFilters,
  CreateControlInput,
  SetSoaEntryInput,
  SoaCoverage,
  SoaEntry,
  SoaFilters,
  SoaRow,
  UntreatedRisk,
  UpdateControlInput,
} from '../control.types';

export const CONTROL_REPOSITORY = Symbol('CONTROL_REPOSITORY');

export interface IControlRepository {
  // ── Catalogue ──────────────────────────────────────────────────────────────
  createControl(input: CreateControlInput, tx?: DbExecutor): Promise<Control>;
  findControlById(id: string, tx?: DbExecutor): Promise<Control | null>;
  findControlByReference(reference: string): Promise<Control | null>;
  listControls(
    filters: ControlFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: Control[]; total: number }>;
  updateControl(id: string, input: UpdateControlInput, tx?: DbExecutor): Promise<Control | null>;
  /** Retire a control. Returns null when it was already retired — the guard is in the WHERE. */
  retireControl(id: string, tx?: DbExecutor): Promise<Control | null>;

  // ── Statement of Applicability ─────────────────────────────────────────────
  findEntryByControl(controlId: string, tx?: DbExecutor): Promise<SoaEntry | null>;
  /**
   * Insert or replace the decision for one control, in a single statement.
   *
   * `ON CONFLICT (control_id) DO UPDATE` rather than a read-then-branch: `uq_soa_control` is what
   * makes the statement unique, and two concurrent writers would both pass a read that found
   * nothing and then one would fail on the index. The upsert makes the last writer win, which is
   * the right outcome for a statement of fact.
   */
  upsertEntry(controlId: string, input: SetSoaEntryInput, tx?: DbExecutor): Promise<SoaEntry>;
  listEntries(
    filters: SoaFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: SoaRow[]; total: number }>;
  /** Stamp `last_reviewed_at` and move the next review date on. */
  markReviewed(
    controlId: string,
    reviewDueOn: string | null,
    tx?: DbExecutor,
  ): Promise<SoaEntry | null>;

  // ── Risk ↔ control ─────────────────────────────────────────────────────────
  linkRiskControl(
    riskId: string,
    controlId: string,
    linkedBy: string,
    tx?: DbExecutor,
  ): Promise<void>;
  unlinkRiskControl(riskId: string, controlId: string, tx?: DbExecutor): Promise<boolean>;
  /** Controls treating one risk, with their SoA status where a decision exists. */
  listControlsForRisk(riskId: string): Promise<(Control & { status: string | null })[]>;
  listRisksForControl(
    controlId: string,
  ): Promise<{ id: string; reference: string; title: string }[]>;

  // ── Reports ────────────────────────────────────────────────────────────────
  /**
   * The coverage counts, as ONE query.
   *
   * Counting in TypeScript would mean paging the whole catalogue into memory to answer a question
   * that is four `count(*) FILTER` expressions.
   */
  soaCoverage(): Promise<SoaCoverage>;
  /**
   * Open risks that no control treats.
   *
   * An anti-join, not a loop: the gap report is the reason the link table exists, and computing it
   * per risk in the service would be an N+1 over the register.
   */
  untreatedRisks(limit: number): Promise<UntreatedRisk[]>;
}
