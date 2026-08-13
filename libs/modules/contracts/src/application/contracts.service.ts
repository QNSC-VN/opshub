import { Inject, Injectable } from '@nestjs/common';
import {
  ConflictException,
  ErrorCodes,
  InjectDrizzle,
  NotFoundException,
  NotificationSchedulerService,
  PreconditionFailedException,
  assertDateOrder,
  type DbExecutor,
  type DrizzleDB,
} from '@platform';
import type { Actor } from '@shared-kernel';
import { addDays, today, daysBetween } from '@shared-kernel';
import { AUDIT_ACTION, AUDIT_RESOURCE, AuditService, type AuditAction } from '@modules/audit';
import { EmployeeService } from '@modules/identity';
import {
  CONTRACTS_REPOSITORY,
  type IContractsRepository,
} from '../domain/ports/contracts.repository';
import type {
  ContractFilters,
  ContractType,
  DraftContractInput,
  EmploymentContract,
  UpdateContractInput,
} from '../domain/contracts.types';

/**
 * Employment contracts: their terms, their lifecycle, and their succession.
 *
 * WHAT THIS SERVICE OWNS THAT THE DATABASE CANNOT
 *
 * 1. TRANSITIONS. `ck_contract_type_end_date` and the window CHECKs describe a valid ROW; they say
 *    nothing about which change is allowed from which state. "Only a draft may be edited", "only a
 *    signed contract may be activated", "only an active contract may be terminated" are rules about
 *    the move, and a CHECK cannot see the previous value. They are enforced here, and every one of
 *    them is also expressed as a guarded `WHERE status = <from>` in the repository, so a race
 *    between two callers is decided by Postgres rather than by whoever read first.
 *
 * 2. TRANSLATING CONSTRAINTS INTO ANSWERS. Each CHECK is restated as a coded refusal before the
 *    write. Not defensive duplication: a raw constraint violation reaches the caller as a 500 with
 *    no error code, which is indistinguishable from the server being broken. The CHECK remains the
 *    thing that is actually true; this makes it explainable.
 *
 * 3. RENEWAL IS ONE ACT. The outgoing contract leaves `active` BEFORE the incoming one enters it.
 *    That order is forced by `uq_employee_active_contract` — doing it the other way hits the index —
 *    which is the intended behaviour rather than an obstacle: a renewal cannot half-happen and leave
 *    an employee with two live agreements or none.
 */
@Injectable()
export class ContractsService {
  constructor(
    @Inject(CONTRACTS_REPOSITORY) private readonly repo: IContractsRepository,
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly audit: AuditService,
    private readonly notifications: NotificationSchedulerService,
    private readonly employees: EmployeeService,
  ) {}

  // ── Reads ────────────────────────────────────────────────────────────────────

  async getContract(id: string): Promise<EmploymentContract> {
    const contract = await this.repo.findById(id);
    if (!contract) throw new NotFoundException(ErrorCodes.NOT_FOUND, `Contract ${id} not found`);
    return contract;
  }

  async listContracts(filters: ContractFilters, limit: number, offset: number) {
    return this.repo.list(filters, limit, offset);
  }

  async listForEmployee(employeeId: string): Promise<EmploymentContract[]> {
    return this.repo.listForEmployee(employeeId);
  }

  async activeForEmployee(employeeId: string): Promise<EmploymentContract | null> {
    return this.repo.findActiveForEmployee(employeeId);
  }

  // ── Terms validation ─────────────────────────────────────────────────────────

  /**
   * `ck_contract_type_end_date` and the window CHECKs, stated as refusals.
   *
   * Takes the FULL intended shape rather than a patch, so an update that changes only the type is
   * validated against the end date already on the row — checking the patch alone would let
   * `{ contractType: 'permanent' }` through onto a row that still carries an end date, and the
   * database would answer with a 500.
   */
  private assertTerms(terms: {
    contractType: ContractType;
    startDate: string;
    endDate?: string | null;
    probationEndDate?: string | null;
  }): void {
    const permanent = terms.contractType === 'permanent';
    if (permanent && terms.endDate) {
      throw new PreconditionFailedException(
        ErrorCodes.CONTRACT_INVALID_TERM,
        'A permanent contract cannot have an end date — a fixed engagement is a different type',
      );
    }
    if (!permanent && !terms.endDate) {
      throw new PreconditionFailedException(
        ErrorCodes.CONTRACT_INVALID_TERM,
        `A ${terms.contractType} contract needs an end date`,
      );
    }
    if (terms.endDate) {
      assertDateOrder(
        terms.startDate,
        terms.endDate,
        ErrorCodes.CONTRACT_INVALID_WINDOW,
        'A contract cannot end before it starts',
      );
    }
    if (terms.probationEndDate) {
      assertDateOrder(
        terms.startDate,
        terms.probationEndDate,
        ErrorCodes.CONTRACT_INVALID_WINDOW,
        'Probation cannot end before the contract starts',
      );
    }
  }

  // ── Writes ───────────────────────────────────────────────────────────────────

  /** Draft a contract. Draft, not active: a contract is negotiated before it binds anyone. */
  async draftContract(input: DraftContractInput, actor: Actor): Promise<EmploymentContract> {
    this.assertTerms(input);

    if (await this.repo.findByReference(input.reference)) {
      throw new ConflictException(
        ErrorCodes.CONFLICT,
        `Contract reference '${input.reference}' is already in use`,
      );
    }

    return this.db.transaction(async (tx) => {
      const contract = await this.repo.create(input, tx);
      await this.recordAudit(AUDIT_ACTION.CONTRACT_DRAFTED, contract, actor, tx, {
        after: {
          reference: contract.reference,
          contractType: contract.contractType,
          startDate: contract.startDate,
          endDate: contract.endDate,
        },
      });
      return contract;
    });
  }

  /**
   * Change a draft's terms.
   *
   * Drafts only, enforced by the repository's WHERE clause as well as the check here. An active
   * contract's terms are what somebody signed; changing them is a renewal.
   */
  async updateContract(
    id: string,
    input: UpdateContractInput,
    actor: Actor,
  ): Promise<EmploymentContract> {
    const before = await this.getContract(id);
    if (before.status !== 'draft') {
      throw new PreconditionFailedException(
        ErrorCodes.CONTRACT_NOT_DRAFT,
        `Contract ${before.reference} is '${before.status}' — only a draft may be edited. ` +
          'Record a renewal instead.',
      );
    }

    // Merged, not patched: see `assertTerms`.
    this.assertTerms({
      contractType: input.contractType ?? before.contractType,
      startDate: input.startDate ?? before.startDate,
      endDate: input.endDate === undefined ? before.endDate : input.endDate,
      probationEndDate:
        input.probationEndDate === undefined ? before.probationEndDate : input.probationEndDate,
    });

    return this.db.transaction(async (tx) => {
      const after = await this.repo.update(id, input, tx);
      if (!after) {
        // The WHERE clause is draft-only, so a null here means the status moved between the read
        // above and this write — a race, not a missing row.
        throw new ConflictException(
          ErrorCodes.CONTRACT_NOT_DRAFT,
          `Contract ${before.reference} is no longer a draft`,
        );
      }
      await this.recordAudit(AUDIT_ACTION.CONTRACT_UPDATED, after, actor, tx, {
        before: { contractType: before.contractType, endDate: before.endDate },
        after: { contractType: after.contractType, endDate: after.endDate },
      });
      return after;
    });
  }

  /**
   * Make a draft the employee's live contract.
   *
   * Refuses when they already hold one: replacing it is a RENEWAL, which is a different act with a
   * different audit trail, and letting activation quietly supersede would lose that distinction.
   */
  async activateContract(
    id: string,
    input: { signedAt?: string },
    actor: Actor,
  ): Promise<EmploymentContract> {
    const contract = await this.getContract(id);
    this.assertActivatable(contract, input.signedAt);

    return this.db.transaction(async (tx) => {
      const existing = await this.repo.findActiveForEmployee(contract.employeeId, tx);
      if (existing) {
        throw new ConflictException(
          ErrorCodes.CONTRACT_ALREADY_ACTIVE,
          `The employee already holds active contract ${existing.reference}. ` +
            'Record a renewal to replace it.',
        );
      }
      return this.activateWithin(contract, input.signedAt, actor, tx);
    });
  }

  /**
   * Replace an active contract with a drafted one, in one transaction.
   *
   * The outgoing contract leaves `active` FIRST. That order is not a preference: doing it the other
   * way round hits `uq_employee_active_contract`, which is exactly what makes a renewal atomic.
   */
  async renewContract(
    outgoingId: string,
    incomingId: string,
    input: { signedAt?: string },
    actor: Actor,
  ): Promise<EmploymentContract> {
    if (outgoingId === incomingId) {
      throw new PreconditionFailedException(
        ErrorCodes.PRECONDITION_FAILED,
        'A contract cannot renew itself',
      );
    }

    const outgoing = await this.getContract(outgoingId);
    const incoming = await this.getContract(incomingId);

    if (outgoing.employeeId !== incoming.employeeId) {
      throw new PreconditionFailedException(
        ErrorCodes.PRECONDITION_FAILED,
        'A renewal must be for the same employee',
      );
    }
    if (outgoing.status !== 'active') {
      throw new PreconditionFailedException(
        ErrorCodes.CONTRACT_NOT_ACTIVE,
        `Contract ${outgoing.reference} is '${outgoing.status}' and cannot be renewed`,
      );
    }
    this.assertActivatable(incoming, input.signedAt);
    // The successor starts when the predecessor stops, at the earliest. Reversed, the employee would
    // hold two contracts over the overlap — which the index prevents at any instant, but the DATES
    // would still claim it.
    assertDateOrder(
      outgoing.startDate,
      incoming.startDate,
      ErrorCodes.CONTRACT_INVALID_WINDOW,
      'A renewal cannot start before the contract it replaces',
    );

    return this.db.transaction(async (tx) => {
      const closed = await this.repo.transition(outgoing.id, 'active', 'expired', {}, tx);
      if (!closed) {
        throw new ConflictException(
          ErrorCodes.CONTRACT_NOT_ACTIVE,
          `Contract ${outgoing.reference} is no longer active`,
        );
      }

      const activated = await this.activateWithin(incoming, input.signedAt, actor, tx, {
        action: AUDIT_ACTION.CONTRACT_RENEWED,
        before: { reference: outgoing.reference, status: outgoing.status },
      });

      // Forward link, written last so it can only ever point at a contract that did activate.
      await this.repo.transition(
        closed.id,
        'expired',
        'expired',
        { supersededById: activated.id },
        tx,
      );
      return activated;
    });
  }

  /** End an active contract by decision rather than by time. */
  async terminateContract(
    id: string,
    input: { terminatedOn: string; terminationReason: string },
    actor: Actor,
  ): Promise<EmploymentContract> {
    const contract = await this.getContract(id);
    if (contract.status !== 'active') {
      throw new PreconditionFailedException(
        ErrorCodes.CONTRACT_NOT_ACTIVE,
        `Contract ${contract.reference} is '${contract.status}' and cannot be terminated`,
      );
    }
    assertDateOrder(
      contract.startDate,
      input.terminatedOn,
      ErrorCodes.CONTRACT_INVALID_WINDOW,
      'A contract cannot be terminated before it started',
    );

    return this.db.transaction(async (tx) => {
      const terminated = await this.repo.transition(
        id,
        'active',
        'terminated',
        { terminatedOn: input.terminatedOn, terminationReason: input.terminationReason },
        tx,
      );
      if (!terminated) {
        throw new ConflictException(
          ErrorCodes.CONTRACT_NOT_ACTIVE,
          `Contract ${contract.reference} is no longer active`,
        );
      }
      await this.recordAudit(AUDIT_ACTION.CONTRACT_TERMINATED, terminated, actor, tx, {
        before: { status: 'active' },
        after: { status: 'terminated', terminatedOn: input.terminatedOn },
      });
      return terminated;
    });
  }

  // ── The sweep ────────────────────────────────────────────────────────────────

  /**
   * Mark contracts whose end date has passed as expired, and notify about them.
   *
   * Run from the worker's cron under `ExclusiveJob`, so a second replica cannot double-run it. Each
   * contract is its OWN transaction: one row that fails a constraint must not prevent the other
   * hundred from being swept, and there is no invariant spanning two contracts here.
   *
   * The transition is guarded on `active`, so a contract terminated between the list and the update
   * is skipped rather than overwritten — which is why the count returned is of contracts actually
   * moved, not of rows the query found.
   */
  async expireDueContracts(asOf: string = today(), limit = 500): Promise<number> {
    const due = await this.repo.listExpired(asOf, limit);
    let expired = 0;

    for (const contract of due) {
      const moved = await this.db.transaction(async (tx) => {
        const row = await this.repo.transition(contract.id, 'active', 'expired', {}, tx);
        if (!row) return false;

        await this.audit.record(
          {
            // No actor: time did this, not a person. `actorId: null` is what distinguishes a swept
            // expiry from someone terminating a contract on its last day.
            actorId: null,
            actorEmail: null,
            action: AUDIT_ACTION.CONTRACT_EXPIRED,
            resourceType: AUDIT_RESOURCE.EMPLOYMENT_CONTRACT,
            resourceId: row.id,
            changes: { before: { status: 'active' }, after: { status: 'expired' } },
          },
          tx,
        );
        await this.notifications.schedule(tx, {
          type: 'contract.expired',
          recipientId: row.employeeId,
          resourceId: row.id,
          vars: {
            employeeName: await this.displayName(row.employeeId),
            reference: row.reference,
            endDate: contract.endDate,
          },
          // One notification per contract per expiry, whatever the sweep's cadence.
          idempotencyKey: `contract.expired:${row.id}`,
        });
        return true;
      });
      if (moved) expired++;
    }

    return expired;
  }

  /**
   * Notify about contracts ending within `withinDays`.
   *
   * Deduplicated by `notification_outbox.idempotency_key`, which is why this can run hourly without
   * anyone being told twice: the key carries the contract id and the milestone, so a contract stays
   * quiet until it crosses the next threshold. Without that key an hourly cron sends 24 reminders a
   * day, which trains people to ignore all of them.
   */
  async remindExpiringContracts(
    withinDays: number,
    asOf: string = today(),
    limit = 500,
  ): Promise<number> {
    const soon = await this.repo.listExpiringBetween(asOf, addDays(asOf, withinDays), limit);

    for (const contract of soon) {
      await this.db.transaction(async (tx) => {
        await this.notifications.schedule(tx, {
          type: 'contract.expiring_soon',
          recipientId: contract.employeeId,
          resourceId: contract.id,
          vars: {
            employeeName: await this.displayName(contract.employeeId),
            reference: contract.reference,
            endDate: contract.endDate,
            daysRemaining: daysBetween(asOf, contract.endDate),
          },
          idempotencyKey: `contract.expiring_soon:${contract.id}:${withinDays}`,
        });
      });
    }

    return soon.length;
  }

  // ── Shared internals ─────────────────────────────────────────────────────────

  /** The state a contract must be in to become active, whether directly or through a renewal. */
  private assertActivatable(contract: EmploymentContract, signedAt?: string): void {
    if (contract.status !== 'draft') {
      throw new PreconditionFailedException(
        ErrorCodes.CONTRACT_NOT_DRAFT,
        `Contract ${contract.reference} is '${contract.status}' — only a draft may be activated`,
      );
    }
    if (!contract.signedAt && !signedAt) {
      throw new PreconditionFailedException(
        ErrorCodes.CONTRACT_NOT_SIGNED,
        `Contract ${contract.reference} has no signature date. ` +
          'Supply `signedAt`, or record the signature first.',
      );
    }
    if (contract.endDate && contract.endDate < today()) {
      throw new PreconditionFailedException(
        ErrorCodes.CONTRACT_ALREADY_ENDED,
        `Contract ${contract.reference} ended on ${contract.endDate} and cannot be activated`,
      );
    }
  }

  /**
   * draft → active, inside a transaction the caller already opened.
   *
   * Shared by `activateContract` and `renewContract` so the audit shape, the guarded transition and
   * the signature default cannot drift apart between the two paths.
   */
  private async activateWithin(
    contract: EmploymentContract,
    signedAt: string | undefined,
    actor: Actor,
    tx: DbExecutor,
    audit?: { action: AuditAction; before: object },
  ): Promise<EmploymentContract> {
    const activated = await this.repo.transition(
      contract.id,
      'draft',
      'active',
      { signedAt: signedAt ? new Date(signedAt) : (contract.signedAt ?? new Date()) },
      tx,
    );
    if (!activated) {
      throw new ConflictException(
        ErrorCodes.CONTRACT_NOT_DRAFT,
        `Contract ${contract.reference} is no longer a draft`,
      );
    }

    await this.recordAudit(audit?.action ?? AUDIT_ACTION.CONTRACT_ACTIVATED, activated, actor, tx, {
      before: audit?.before ?? { status: 'draft' },
      after: { status: 'active', reference: activated.reference },
    });
    return activated;
  }

  /**
   * The employee's name for a notification body, falling back to their id.
   *
   * Falls back rather than throwing because the sweep runs unattended: an employee row deleted out
   * from under a contract must not stop the other contracts from being swept, and a notification
   * naming an id is still more useful than no notification and a crashed cron.
   */
  private async displayName(employeeId: string): Promise<string> {
    try {
      return (await this.employees.getById(employeeId)).displayName;
    } catch {
      return employeeId;
    }
  }

  private async recordAudit(
    action: AuditAction,
    contract: EmploymentContract,
    actor: Actor,
    tx: DbExecutor,
    changes: { before?: object | null; after?: object | null },
  ): Promise<void> {
    await this.audit.record(
      {
        actorId: actor.sub,
        actorEmail: actor.email,
        action,
        resourceType: AUDIT_RESOURCE.EMPLOYMENT_CONTRACT,
        resourceId: contract.id,
        changes,
      },
      tx,
    );
  }
}
