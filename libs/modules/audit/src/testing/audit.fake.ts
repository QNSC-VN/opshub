import { vi } from 'vitest';
import type { DbExecutor } from '@platform';
import type { Actor } from '@shared-kernel';
import type { AuditChanges, ResourceAuditTrail } from '../application/audit.service';
import type { AuditAction, AuditResource } from '../domain/audit-catalogue';

/**
 * A faithful stand-in for `AuditService` in unit tests.
 *
 * WHY THIS EXISTS. Every service spec used to write `const audit = { record: vi.fn() }`, which worked
 * only because `record` was the whole surface a service touched. The moment `recordChange` and
 * `forResource` arrived, 118 tests failed at construction — nine copies of one stub, each needing the
 * same two methods added.
 *
 * FAITHFUL, NOT MERELY PRESENT. `forResource` and `recordChange` DELEGATE to the same `record` spy,
 * exactly as the real `AuditService` does. That is what lets a spec assert on `audit.record` without
 * caring which of the three entry points the service chose — and it keeps those assertions honest: if
 * the real delegation chain were ever broken so that a resource-bound write skipped `record`, this
 * fake would still funnel it and the spec would still pass. The chain itself is covered by
 * `audit.service.spec.ts`, which tests the real class.
 */
export interface FakeAudit {
  record: ReturnType<typeof vi.fn>;
  recordChange: ReturnType<typeof vi.fn>;
  forResource: (resourceType: AuditResource) => ResourceAuditTrail;
}

export function createFakeAudit(): FakeAudit {
  const record = vi.fn().mockResolvedValue(undefined);

  const recordChange = vi.fn(
    async (
      actor: Actor,
      action: AuditAction,
      resourceType: AuditResource,
      resourceId: string,
      changes: AuditChanges,
      tx?: DbExecutor,
    ) => {
      await record(
        { actorId: actor.sub, actorEmail: actor.email, action, resourceType, resourceId, changes },
        tx,
      );
    },
  );

  return {
    record,
    recordChange,
    forResource: (resourceType: AuditResource): ResourceAuditTrail => ({
      record: (action, resourceId, actor, tx, changes) =>
        recordChange(actor, action, resourceType, resourceId, changes, tx),
    }),
  };
}
