import { Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { MS_PER_HOUR, newId, type Actor, type RequestType } from '@shared-kernel';
import { InjectDrizzle, type DrizzleDB } from '../database/drizzle.provider';
import { AuthzService } from '../auth/authz.service';
import { ActorScope } from '../auth/actor-scope.service';
import {
  NotFoundException,
  PreconditionFailedException,
  PermissionDeniedException,
} from '../errors/exceptions';
import { ErrorCodes } from '../errors/error-codes';
import { WebhookEnqueueService } from '../webhooks/webhook-enqueue.service';
import { requestItems, requestApprovals, requestComments } from '../../../../db/schema';
import { RequestRegistry } from './request-registry';
import { DelegationService } from '../authz/delegation.service';
import { NotificationSchedulerService } from '../notifications/notification-scheduler.service';
import type {
  RequestFilters,
  RequestItem,
  RequestItemWithApprovals,
  RequestStatus,
  RequestComment,
  SubmitRequestOptions,
} from './request-engine.types';

/**
 * Universal request state machine. All request workflows (access, leave,
 * overtime, onboarding…) go through this service for state transitions.
 *
 * Responsibilities:
 *  - SoD enforcement (requester ≠ approver, configurable per type)
 *  - Permission check via AuthzService before any approval
 *  - Atomic transactions: state update + TypeDef hook + webhook fan-out
 *  - Unified inbox queries via `list()`
 *
 * TypeDef hooks are called INSIDE the transaction so domain side-effects
 * (e.g. creating access_grants, updating leave status) are atomic.
 */
@Injectable()
export class RequestEngine {
  private readonly logger = new Logger(RequestEngine.name);

  constructor(
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly registry: RequestRegistry,
    private readonly authz: AuthzService,
    private readonly actorScope: ActorScope,
    private readonly delegation: DelegationService,
    private readonly notifScheduler: NotificationSchedulerService,
    private readonly webhookEnqueue: WebhookEnqueueService,
  ) {}

  // ── Submit ────────────────────────────────────────────────────────────────

  async submit(
    type: RequestType,
    payload: Record<string, unknown>,
    actor: Actor,
    opts?: SubmitRequestOptions,
  ): Promise<RequestItem> {
    const def = this.registry.get(type);

    const expiresAt =
      opts?.expiresAt ??
      (def.defaultExpiryHours ? new Date(Date.now() + def.defaultExpiryHours * MS_PER_HOUR) : null);

    // SLA deadline — stored for breach cron; separate from expiry
    const slaHours = def.slaHours ?? null;
    const slaDeadline = slaHours ? new Date(Date.now() + slaHours * MS_PER_HOUR) : null;

    // Multi-step chain metadata — stored immutably at submit time
    const totalSteps = def.approvalSteps ? def.approvalSteps.length : 1;

    const item = await this.db.transaction(async (tx) => {
      // Allow TypeDef to validate payload / check domain constraints
      if (def.onSubmit) {
        await def.onSubmit(payload, actor.sub, tx);
      }

      const [row] = await tx
        .insert(requestItems)
        .values({
          id: newId(),
          type,
          requesterId: actor.sub,
          assigneeId: opts?.assigneeId ?? null,
          status: 'pending',
          priority: opts?.priority ?? 'normal',
          payload,
          expiresAt,
          slaHours,
          slaDeadline,
          currentStep: 1,
          totalSteps,
        })
        .returning();

      const submitPayload = {
        requestId: row.id,
        type,
        requesterId: actor.sub,
        priority: row.priority,
      };
      await this.webhookEnqueue.fanout(tx, 'request.submitted', submitPayload);

      // Notify the initial assignee (if any) that a new request awaits review.
      if (row.assigneeId) {
        await this.notifScheduler.schedule(tx, {
          type: 'request.submitted',
          vars: { requestType: type, requestId: row.id, requesterEmail: actor.email },
          recipientId: row.assigneeId,
          actorId: actor.sub,
          resourceId: row.id,
          idempotencyKey: `request_submitted:${row.id}`,
        });
      }

      return row;
    });

    this.logger.log({ requestId: item.id, type }, 'Request submitted');
    return item;
  }

  // ── Approve ────────────────────────────────────────────────────────────────

  async approve(requestId: string, note: string | null, actor: Actor): Promise<RequestItem> {
    const request = await this.getOrFail(requestId);
    this.assertApprovable(request.status);

    const def = this.registry.get(request.type);

    // ── Multi-step: resolve which step we're on ──────────────────────────────
    const steps = def.approvalSteps;
    const currentStep = request.currentStep;
    const stepDef = steps?.find((s) => s.step === currentStep) ?? null;
    const requiredPermission = stepDef?.requiredPermission ?? def.requiredApprovalPermission;
    const maxStep = steps ? Math.max(...steps.map((s) => s.step)) : 1;
    const isFinalStep = !steps || currentStep >= maxStep;

    // ── Delegation check ─────────────────────────────────────────────────────
    const activeDelegation = await this.delegation.findActiveDelegationTo(actor.sub);
    const sodSubject = activeDelegation ? activeDelegation.fromUserId : actor.sub;

    if (!def.allowSelfApproval && request.requesterId === sodSubject) {
      throw new PermissionDeniedException(
        'Requester cannot approve their own request',
        // The CODE, not a prefix on the message. A client distinguishing this from a missing
        // permission is the difference between "ask a colleague" and "ask for access".
        ErrorCodes.REQUEST_SOD_VIOLATION,
      );
    }

    // Permission check: actor OR delegator (union semantics)
    const actorAllowed = await this.authz.check(actor.sub, requiredPermission);
    const delegatorAllowed = activeDelegation
      ? await this.authz.check(activeDelegation.fromUserId, requiredPermission)
      : false;
    if (!actorAllowed && !delegatorAllowed) {
      throw new PermissionDeniedException(
        `Missing permission for step ${currentStep}: ${requiredPermission}`,
      );
    }

    const now = new Date();
    const updated = await this.db.transaction(async (tx) => {
      const nextStep = currentStep + 1;
      const nextStepDef = steps?.find((s) => s.step === nextStep) ?? null;

      // Resolve the assignee for the next step (if defined)
      let nextAssigneeId: string | null = request.assigneeId;
      if (!isFinalStep && nextStepDef?.resolverFn) {
        nextAssigneeId = (await nextStepDef.resolverFn(request.payload, tx)) ?? request.assigneeId;
      }

      const newStatus: RequestStatus = isFinalStep ? 'approved' : 'in_review';

      const [row] = await tx
        .update(requestItems)
        .set({
          status: newStatus,
          currentStep: isFinalStep ? currentStep : nextStep,
          assigneeId: isFinalStep ? request.assigneeId : nextAssigneeId,
          resolvedAt: isFinalStep ? now : null,
          resolutionNote: isFinalStep ? note : null,
          updatedAt: now,
        })
        .where(eq(requestItems.id, requestId))
        .returning();

      await tx.insert(requestApprovals).values({
        id: newId(),
        requestId,
        step: currentStep,
        approverId: actor.sub,
        decision: 'approved',
        note,
        delegatedFromId: activeDelegation?.fromUserId ?? null,
      });

      if (isFinalStep) {
        // Final approval: call domain hook
        await def.onApprove(request.payload, requestId, actor.sub, tx);
        // Notify the requester their request has been approved.
        await this.notifScheduler.schedule(tx, {
          type: 'request.approved',
          vars: { requestType: request.type, requestId },
          recipientId: request.requesterId,
          actorId: actor.sub,
          resourceId: requestId,
          idempotencyKey: `request_approved:${requestId}`,
        });
      } else {
        // Intermediate approval: call optional step hook and notify next assignee
        if (def.onStepApproved) {
          await def.onStepApproved(
            request.payload,
            requestId,
            currentStep,
            nextStep,
            nextAssigneeId,
            actor.sub,
            tx,
          );
        }

        // Notify the next assignee if one is resolved
        if (nextAssigneeId) {
          await this.notifScheduler.schedule(tx, {
            type: 'request.step_ready',
            vars: {
              requestType: request.type,
              requestId,
              completedStep: currentStep,
              nextStep,
              totalSteps: maxStep,
            },
            recipientId: nextAssigneeId,
            resourceId: requestId,
            idempotencyKey: `step_ready:${requestId}:${nextStep}`,
          });
        }
      }

      const approvalEventType = isFinalStep ? 'request.approved' : 'request.step_approved';
      const approvalPayload = {
        requestId,
        type: request.type,
        approverId: actor.sub,
        step: currentStep,
        isFinalStep,
        totalSteps: maxStep,
      };
      await this.webhookEnqueue.fanout(tx, approvalEventType, approvalPayload);

      return row;
    });

    this.logger.log(
      { requestId, type: request.type, step: currentStep, isFinalStep },
      isFinalStep ? 'Request approved' : `Request step ${currentStep}/${maxStep} approved`,
    );

    // Post-tx hook for external provisioning/deprovisioning (Graph, GitHub, etc.)
    if (isFinalStep && def.afterApprove) {
      void def.afterApprove(request.payload, requestId, actor.sub).catch((err: unknown) => {
        this.logger.error(
          { requestId, type: request.type },
          `afterApprove hook failed: ${String(err)}`,
        );
      });
    }

    return updated;
  }

  // ── Reject ────────────────────────────────────────────────────────────────

  async reject(requestId: string, note: string | null, actor: Actor): Promise<RequestItem> {
    const request = await this.getOrFail(requestId);
    this.assertApprovable(request.status);

    const def = this.registry.get(request.type);

    // Delegation check — same as approve()
    const activeDelegation = await this.delegation.findActiveDelegationTo(actor.sub);
    const sodSubject = activeDelegation ? activeDelegation.fromUserId : actor.sub;
    if (!def.allowSelfApproval && request.requesterId === sodSubject) {
      throw new PermissionDeniedException(
        'Requester cannot reject their own request',
        // The CODE, not a prefix on the message. A client distinguishing this from a missing
        // permission is the difference between "ask a colleague" and "ask for access".
        ErrorCodes.REQUEST_SOD_VIOLATION,
      );
    }

    // Resolve permission for current step (mirrors approve())
    const steps = def.approvalSteps;
    const currentStep = request.currentStep;
    const stepDef = steps?.find((s) => s.step === currentStep) ?? null;
    const requiredPermission = stepDef?.requiredPermission ?? def.requiredApprovalPermission;

    const actorAllowed = await this.authz.check(actor.sub, requiredPermission);
    const delegatorAllowed = activeDelegation
      ? await this.authz.check(activeDelegation.fromUserId, requiredPermission)
      : false;
    if (!actorAllowed && !delegatorAllowed) {
      throw new PermissionDeniedException(
        `Missing permission for step ${currentStep}: ${requiredPermission}`,
      );
    }

    const now = new Date();
    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(requestItems)
        .set({ status: 'rejected', resolvedAt: now, resolutionNote: note, updatedAt: now })
        .where(eq(requestItems.id, requestId))
        .returning();

      await tx.insert(requestApprovals).values({
        id: newId(),
        requestId,
        step: currentStep,
        approverId: actor.sub,
        decision: 'rejected',
        note,
        delegatedFromId: activeDelegation?.fromUserId ?? null,
      });

      if (def.onReject) {
        await def.onReject(request.payload, requestId, actor.sub, tx);
      }

      // Notify the requester their request has been rejected.
      await this.notifScheduler.schedule(tx, {
        type: 'request.rejected',
        vars: { requestType: request.type, requestId, reason: note ?? undefined },
        recipientId: request.requesterId,
        actorId: actor.sub,
        resourceId: requestId,
        idempotencyKey: `request_rejected:${requestId}`,
      });

      const rejectedPayload = { requestId, type: request.type, approverId: actor.sub, note };
      await this.webhookEnqueue.fanout(tx, 'request.rejected', rejectedPayload);

      return row;
    });

    this.logger.log({ requestId, type: request.type }, 'Request rejected');
    return updated;
  }

  // ── Cancel ─────────────────────────────────────────────────────────────────

  async cancel(requestId: string, actor: Actor): Promise<RequestItem> {
    const request = await this.getOrFail(requestId);

    // Only the requester (or an admin via rbac.manage) can cancel
    const canAdminCancel = await this.authz.check(actor.sub, 'rbac.manage');
    if (request.requesterId !== actor.sub && !canAdminCancel) {
      throw new PermissionDeniedException('Only the requester can cancel their own request');
    }

    if (request.status !== 'pending' && request.status !== 'in_review') {
      throw new PreconditionFailedException(
        'REQUEST_NOT_CANCELLABLE',
        `Cannot cancel a request with status '${request.status}'`,
      );
    }

    const def = this.registry.get(request.type);
    const now = new Date();

    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(requestItems)
        .set({ status: 'cancelled', resolvedAt: now, updatedAt: now })
        .where(eq(requestItems.id, requestId))
        .returning();

      if (def.onCancel) {
        await def.onCancel(request.payload, requestId, actor.sub, tx);
      }

      const cancelledPayload = { requestId, type: request.type, cancelledBy: actor.sub };
      await this.webhookEnqueue.fanout(tx, 'request.cancelled', cancelledPayload);

      return row;
    });

    return updated;
  }

  // ── Expire (called by worker cron) ─────────────────────────────────────────

  async expire(requestId: string): Promise<void> {
    const request = await this.getOrFail(requestId);
    if (request.status !== 'pending' && request.status !== 'in_review') return;

    const def = this.registry.get(request.type);
    const now = new Date();

    await this.db.transaction(async (tx) => {
      await tx
        .update(requestItems)
        .set({ status: 'expired', resolvedAt: now, updatedAt: now })
        .where(eq(requestItems.id, requestId));

      if (def.onExpire) {
        await def.onExpire(request.payload, requestId, tx);
      }

      const expiredPayload = { requestId, type: request.type };
      await this.webhookEnqueue.fanout(tx, 'request.expired', expiredPayload);
    });

    this.logger.log({ requestId, type: request.type }, 'Request expired');
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  /**
   * Read one request, if the actor is a party to it or holds `request.read`.
   *
   * Performed no check at all before: any authenticated caller could read any request by id,
   * including its approval chain and the requester's justification.
   *
   * The check lives HERE and not in {@link loadUnchecked}, which the transitions use. An
   * approver is frequently neither the requester nor the current assignee — a multi-step chain
   * resolves the next assignee only when it advances — and `approve` already gates on the
   * step's own `requiredPermission`. Asserting party on the internal read would have refused
   * exactly the approvals this engine exists to route.
   */
  async getById(id: string, actor: Actor): Promise<RequestItemWithApprovals | null> {
    const item = await this.loadUnchecked(id);
    if (!item) return null;

    await this.actorScope.assertParty(
      [item.requesterId, item.assigneeId],
      actor,
      'request.read',
      'request',
    );
    return item;
  }

  /** The raw read, with no authorization: for transitions that gate on their own permission. */
  private async loadUnchecked(id: string): Promise<RequestItemWithApprovals | null> {
    const [row] = await this.db.select().from(requestItems).where(eq(requestItems.id, id)).limit(1);
    if (!row) return null;

    const approvalRows = await this.db
      .select()
      .from(requestApprovals)
      .where(eq(requestApprovals.requestId, id))
      .orderBy(
        asc(requestApprovals.step),
        asc(requestApprovals.decidedAt),
        asc(requestApprovals.id),
      );

    return { ...row, approvals: approvalRows };
  }

  /**
   * List requests the actor may see.
   *
   * NARROWS TO THE ACTOR WITHOUT `request.read`. Every condition below is derived from an
   * OPTIONAL filter, so `where` was `undefined` for an unfiltered call and this returned EVERY
   * request in the system — leave, onboarding, access, catalog — to any authenticated caller.
   * `actorId` was used for nothing but the `myQueue` shortcut. Found while giving each route an
   * explicit authorization declaration; no test covered it because no test called it unfiltered
   * as a principal without permissions.
   *
   * A party to a request is its requester OR its assignee, so the narrowed form is that
   * disjunction rather than `requesterId = actor` — an approver must still see their queue.
   */
  async list(
    filters: RequestFilters,
    actorId: string,
    limit: number,
    offset: number,
  ): Promise<{ rows: RequestItemWithApprovals[]; total: number }> {
    const unrestricted = await this.authz.check(actorId, 'request.read');

    const conditions = [
      filters.type ? eq(requestItems.type, filters.type) : undefined,
      filters.requesterId ? eq(requestItems.requesterId, filters.requesterId) : undefined,
      filters.status ? eq(requestItems.status, filters.status) : undefined,
      filters.myQueue
        ? or(
            eq(requestItems.assigneeId, actorId),
            and(isNull(requestItems.assigneeId), eq(requestItems.status, 'pending')),
          )
        : filters.assigneeId
          ? eq(requestItems.assigneeId, filters.assigneeId)
          : undefined,
      // The narrowing predicate, ANDed with whatever the caller asked for. Applied here rather
      // than by rewriting `filters` so a caller cannot widen it back out with `requesterId`.
      unrestricted
        ? undefined
        : or(eq(requestItems.requesterId, actorId), eq(requestItems.assigneeId, actorId)),
    ].filter(Boolean);

    const where = conditions.length ? and(...conditions) : undefined;

    const rows = await this.db
      .select()
      .from(requestItems)
      .where(where)
      .orderBy(desc(requestItems.createdAt), desc(requestItems.id))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(requestItems)
      .where(where);

    // Batch-load approvals in a single query — no N+1
    const ids = rows.map((r) => r.id);
    const allApprovals =
      ids.length > 0
        ? await this.db
            .select()
            .from(requestApprovals)
            .where(inArray(requestApprovals.requestId, ids))
            .orderBy(
              asc(requestApprovals.step),
              asc(requestApprovals.decidedAt),
              asc(requestApprovals.id),
            )
        : [];

    const approvalMap = new Map<string, RequestItemWithApprovals['approvals']>();
    for (const a of allApprovals) {
      const key = (a as { requestId: string }).requestId;
      (approvalMap.get(key) ?? approvalMap.set(key, []).get(key)!).push(a);
    }

    return {
      rows: rows.map((r) => ({
        ...r,
        approvals: approvalMap.get(r.id) ?? [],
      })),
      total: count,
    };
  }

  /** Fetch IDs of pending requests past their deadline (for the expiry cron). */
  async findExpired(batchSize = 50): Promise<string[]> {
    const rows = await this.db
      .select({ id: requestItems.id })
      .from(requestItems)
      .where(
        and(
          or(eq(requestItems.status, 'pending'), eq(requestItems.status, 'in_review')),
          sql`${requestItems.expiresAt} < now()`,
          sql`${requestItems.expiresAt} is not null`,
        ),
      )
      .limit(batchSize);
    return rows.map((r) => r.id);
  }

  // ── Comments ───────────────────────────────────────────────────────────────

  /** Post a discussion comment on a request. Does not trigger any state transition. */
  async addComment(requestId: string, body: string, actor: Actor): Promise<RequestComment> {
    // Verify request exists (throws if not)
    const request = await this.getOrFail(requestId);
    // Commenting used to require only that the request EXISTED, so any authenticated caller
    // could post onto anyone's request — a write, on a record they cannot otherwise read.
    await this.actorScope.assertParty(
      [request.requesterId, request.assigneeId],
      actor,
      'request.read',
      'request',
    );

    const [row] = await this.db
      .insert(requestComments)
      .values({
        id: newId(),
        requestId,
        authorId: actor.sub,
        body: body.trim(),
      })
      .returning();

    return row;
  }

  /** List comments for a request, ordered oldest-first. */
  /** Comments are readable by the request's parties, or a holder of `request.read`. */
  async listComments(requestId: string, actor: Actor): Promise<RequestComment[]> {
    const request = await this.getOrFail(requestId);
    await this.actorScope.assertParty(
      [request.requesterId, request.assigneeId],
      actor,
      'request.read',
      'request',
    );

    const rows = await this.db
      .select()
      .from(requestComments)
      .where(eq(requestComments.requestId, requestId))
      .orderBy(asc(requestComments.createdAt), asc(requestComments.id));
    return rows;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async getOrFail(id: string): Promise<RequestItem> {
    const item = await this.loadUnchecked(id);
    if (!item) throw new NotFoundException('REQUEST_NOT_FOUND', `Request ${id} not found`);
    return item;
  }

  private assertApprovable(status: RequestStatus): void {
    if (status !== 'pending' && status !== 'in_review') {
      throw new PreconditionFailedException(
        'REQUEST_NOT_PENDING',
        `Request is already ${status} and cannot be approved or rejected`,
      );
    }
  }
}
