/**
 * Unit tests — WorkforceService access narrowing.
 *
 * These four collections hold HR records (hours worked, leave reasons, overtime, shift
 * history) behind an OPTIONAL `employeeId` filter, and the narrowing is enforced in the
 * service rather than by a `@RequirePermission` scope descriptor — see the comment on
 * `narrowToActor` for why a descriptor cannot express an optional filter.
 *
 * That makes these tests the only thing standing between the routes and an HR-wide read,
 * because `route-policy.ratchet.spec.ts` deliberately cannot see service-side checks: it
 * still counts all six routes as undecorated. So each assertion here checks BOTH
 * directions — that the privileged tier is not narrowed, and that the unprivileged tier
 * cannot escape its own records.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionDeniedException } from '@platform';
import { ActorScope } from '@platform';
import { WorkforceService } from './workforce.service';

const mockRepo = {
  createTimesheet: vi.fn(),
  findTimesheetById: vi.fn(),
  listTimesheets: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  setTimesheetStatus: vi.fn(),
  createLeave: vi.fn(),
  findLeaveById: vi.fn(),
  listLeave: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  setLeaveStatus: vi.fn(),
  listOvertime: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  listShiftLogs: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
};

const mockAudit = { record: vi.fn() };
const mockEngine = { submit: vi.fn(), approve: vi.fn(), reject: vi.fn() };
const mockStorage = { presignUpload: vi.fn(), confirmUpload: vi.fn() };
const mockAuthz = { check: vi.fn() };

const SELF = { sub: 'emp-1', email: 'emp1@test.com' };
const OTHER = 'emp-2';

function service(): WorkforceService {
  return new WorkforceService(
    mockRepo as never,
    mockAudit as never,
    mockEngine as never,
    mockStorage as never,
    mockAuthz as never,
    // The real ActorScope over the mocked AuthzService — narrowToActor now delegates to it, so
    // stubbing it would remove the logic these tests exist to check.
    new ActorScope(mockAuthz as never),
    // LeaveBalanceService is unused by the narrowing paths under test; a stub keeps this spec
    // about scoping rather than about leave arithmetic, which has its own suite.
    {} as never,
    // db: only the entitlement/holiday writes open a transaction, and none of those are exercised
    // by the narrowing paths under test.
    {} as never,
  );
}

/** Grant or withhold the unconstrained `workforce.read` / `workforce.approve`. */
function holds(...permissions: string[]) {
  mockAuthz.check.mockImplementation((_userId: string, permission: string) =>
    Promise.resolve(permissions.includes(permission)),
  );
}

/** The four list methods, so each rule is asserted against all of them, not just one. */
const LISTS = [
  ['listTimesheets', 'listTimesheets'],
  ['listLeave', 'listLeave'],
  ['listOvertime', 'listOvertime'],
  ['listShiftLogs', 'listShiftLogs'],
] as const;

describe('WorkforceService access narrowing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const [, repoMethod] of LISTS) {
      mockRepo[repoMethod].mockResolvedValue({ rows: [], total: 0 });
    }
  });

  describe.each(LISTS)('%s', (method, repoMethod) => {
    it('pins an unprivileged caller to their own records', async () => {
      holds();
      await service()[method]({}, 20, 0, SELF);
      expect(mockRepo[repoMethod]).toHaveBeenCalledWith({ employeeId: SELF.sub }, 20, 0);
    });

    // The important direction: the SPA sends no filter at all and expects its own rows.
    // If the filter were left empty the caller would receive every employee's records.
    it('injects the filter even when the request carries none', async () => {
      holds();
      await service()[method]({ status: 'pending' } as never, 20, 0, SELF);
      expect(mockRepo[repoMethod]).toHaveBeenCalledWith(
        expect.objectContaining({ employeeId: SELF.sub }),
        20,
        0,
      );
    });

    it("denies an unprivileged caller asking for another employee's records", async () => {
      holds();
      await expect(service()[method]({ employeeId: OTHER }, 20, 0, SELF)).rejects.toThrow(
        PermissionDeniedException,
      );
      expect(mockRepo[repoMethod]).not.toHaveBeenCalled();
    });

    // Denied, not silently narrowed: a narrowed response is indistinguishable from "that
    // employee has no records", which misleads the caller about what they were shown.
    it('does not silently substitute the caller for the requested employee', async () => {
      holds();
      const svc = service();
      await svc[method]({ employeeId: OTHER }, 20, 0, SELF).catch(() => undefined);
      expect(mockRepo[repoMethod]).not.toHaveBeenCalled();
    });

    it('lets an unprivileged caller name themselves explicitly', async () => {
      holds();
      await service()[method]({ employeeId: SELF.sub }, 20, 0, SELF);
      expect(mockRepo[repoMethod]).toHaveBeenCalledWith({ employeeId: SELF.sub }, 20, 0);
    });

    it('leaves a global workforce.read holder unfiltered', async () => {
      holds('workforce.read');
      await service()[method]({}, 20, 0, SELF);
      expect(mockRepo[repoMethod]).toHaveBeenCalledWith({}, 20, 0);
    });

    it('lets a global workforce.read holder filter to another employee', async () => {
      holds('workforce.read');
      await service()[method]({ employeeId: OTHER }, 20, 0, SELF);
      expect(mockRepo[repoMethod]).toHaveBeenCalledWith({ employeeId: OTHER }, 20, 0);
    });

    it('asks about workforce.read with no resource, so a constrained grant denies', async () => {
      // AuthzService.check(userId, permission) with no resource returns true ONLY for a
      // global grant, and logs+denies a constrained one. That is the tier test; passing a
      // resource here would make a self-scoped grant read as HR-wide.
      holds('workforce.read');
      await service()[method]({}, 20, 0, SELF);
      expect(mockAuthz.check).toHaveBeenCalledWith(SELF.sub, 'workforce.read');
    });
  });

  describe('submitTimesheet', () => {
    const draft = { id: 'ts-1', employeeId: SELF.sub, status: 'draft' };

    beforeEach(() => {
      mockRepo.setTimesheetStatus.mockResolvedValue({ ...draft, status: 'submitted' });
    });

    it('lets the owner submit their own draft', async () => {
      holds();
      mockRepo.findTimesheetById.mockResolvedValue(draft);
      await expect(service().submitTimesheet('ts-1', SELF)).resolves.toBeDefined();
    });

    // Previously `(id, _actor)` — the actor was accepted and discarded, so any caller
    // could submit anyone's draft while the audit row named them as the submitter.
    it("denies submitting another employee's draft", async () => {
      holds();
      mockRepo.findTimesheetById.mockResolvedValue({ ...draft, employeeId: OTHER });
      await expect(service().submitTimesheet('ts-1', SELF)).rejects.toThrow(
        PermissionDeniedException,
      );
      expect(mockRepo.setTimesheetStatus).not.toHaveBeenCalled();
    });

    it('lets a global workforce.approve holder submit on an employee behalf', async () => {
      holds('workforce.approve');
      mockRepo.findTimesheetById.mockResolvedValue({ ...draft, employeeId: OTHER });
      await expect(service().submitTimesheet('ts-1', SELF)).resolves.toBeDefined();
    });

    // Ownership is checked BEFORE the state machine, so a caller cannot learn another
    // employee's timesheet status from the error they get back.
    it('checks ownership before the status precondition', async () => {
      holds();
      mockRepo.findTimesheetById.mockResolvedValue({
        ...draft,
        employeeId: OTHER,
        status: 'approved',
      });
      await expect(service().submitTimesheet('ts-1', SELF)).rejects.toThrow(
        PermissionDeniedException,
      );
    });
  });

  describe('cancelLeave', () => {
    const pending = { id: 'lr-1', employeeId: SELF.sub, status: 'pending', requestId: null };

    beforeEach(() => {
      mockRepo.setLeaveStatus.mockResolvedValue({ ...pending, status: 'cancelled' });
    });

    it('lets the requester withdraw their own leave', async () => {
      holds();
      mockRepo.findLeaveById.mockResolvedValue(pending);
      await expect(service().cancelLeave('lr-1', SELF)).resolves.toBeDefined();
    });

    // The one that mattered most: cancellable states include `approved`, so before this
    // check any authenticated user could cancel another employee's granted leave.
    it("denies cancelling another employee's approved leave", async () => {
      holds();
      mockRepo.findLeaveById.mockResolvedValue({
        ...pending,
        employeeId: OTHER,
        status: 'approved',
      });
      await expect(service().cancelLeave('lr-1', SELF)).rejects.toThrow(PermissionDeniedException);
      expect(mockRepo.setLeaveStatus).not.toHaveBeenCalled();
    });

    it('lets a global workforce.approve holder cancel on an employee behalf', async () => {
      holds('workforce.approve');
      mockRepo.findLeaveById.mockResolvedValue({ ...pending, employeeId: OTHER });
      await expect(service().cancelLeave('lr-1', SELF)).resolves.toBeDefined();
    });
  });

  // A caller who owns the record must not need a permission check at all — otherwise
  // self-service would depend on a Redis/DB round-trip that fails closed.
  it('does not consult authz when the caller owns the record', async () => {
    holds();
    mockRepo.findTimesheetById.mockResolvedValue({
      id: 'ts-1',
      employeeId: SELF.sub,
      status: 'draft',
    });
    mockRepo.setTimesheetStatus.mockResolvedValue({ id: 'ts-1', status: 'submitted' });
    await service().submitTimesheet('ts-1', SELF);
    expect(mockAuthz.check).not.toHaveBeenCalled();
  });
});
