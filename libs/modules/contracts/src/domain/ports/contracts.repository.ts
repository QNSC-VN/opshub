import type { DbExecutor } from '@platform';
import type {
  ContractFilters,
  DraftContractInput,
  EmploymentContract,
  ExpiringContract,
  UpdateContractInput,
} from '../contracts.types';

export const CONTRACTS_REPOSITORY = Symbol('CONTRACTS_REPOSITORY');

export interface IContractsRepository {
  create(input: DraftContractInput, tx?: DbExecutor): Promise<EmploymentContract>;
  findById(id: string, tx?: DbExecutor): Promise<EmploymentContract | null>;
  findByReference(reference: string): Promise<EmploymentContract | null>;
  list(
    filters: ContractFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: EmploymentContract[]; total: number }>;
  listForEmployee(employeeId: string): Promise<EmploymentContract[]>;
  /**
   * The employee's live contract, if any.
   *
   * Takes `tx` because activation and renewal both have to read it inside their transaction — read
   * on the pool and two concurrent activations both believe the slot is free, leaving the partial
   * unique index to produce a 500 instead of a domain error.
   */
  findActiveForEmployee(employeeId: string, tx?: DbExecutor): Promise<EmploymentContract | null>;
  update(
    id: string,
    input: UpdateContractInput,
    tx?: DbExecutor,
  ): Promise<EmploymentContract | null>;
  /**
   * Move a contract's status, guarding the FROM state in the WHERE clause.
   *
   * Returns null when the row was not in `from` — which is what makes the transition atomic rather
   * than a read-then-write that two callers can both pass.
   */
  transition(
    id: string,
    from: EmploymentContract['status'],
    to: EmploymentContract['status'],
    extra: Partial<
      Pick<EmploymentContract, 'signedAt' | 'terminatedOn' | 'terminationReason' | 'supersededById'>
    >,
    tx?: DbExecutor,
  ): Promise<EmploymentContract | null>;
  /** Active contracts whose end date has passed — the sweep's first query. */
  listExpired(asOf: string, limit: number): Promise<ExpiringContract[]>;
  /** Active contracts ending within the window — the reminder's query. */
  listExpiringBetween(from: string, to: string, limit: number): Promise<ExpiringContract[]>;
}
