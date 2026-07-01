import type { DbExecutor } from '../database/drizzle.provider';

export type RequestStatus =
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'expired';

export type RequestPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * Defines a single step in a multi-step approval chain.
 * Steps are processed in ascending `step` order.
 */
export interface ApprovalStepDef {
  /** 1-based step number. */
  step: number;
  /** Permission required of the approver at this step. */
  requiredPermission: string;
  /**
   * Optional: resolve the default assignee for this step when the engine
   * advances to it. Called inside the approval transaction.
   * Return null = unassigned (any holder of requiredPermission can approve).
   */
  resolverFn?: (payload: Record<string, unknown>, db: DbExecutor) => Promise<string | null>;
}

/** A comment posted on a request item (non-decision, purely informational). */
export interface RequestComment {
  id: string;
  requestId: string;
  authorId: string;
  body: string;
  editedAt: Date | null;
  createdAt: Date;
}

export interface RequestItem {
  id: string;
  type: string;
  requesterId: string;
  assigneeId: string | null;
  status: RequestStatus;
  priority: RequestPriority;
  payload: Record<string, unknown>;
  resolutionNote: string | null;
  submittedAt: Date;
  resolvedAt: Date | null;
  expiresAt: Date | null;
  /** SLA threshold hours copied from the TypeDef at submit time. Null = no SLA. */
  slaHours: number | null;
  /** Absolute SLA deadline. Null if no SLA defined. */
  slaDeadline: Date | null;
  /** Timestamp of first SLA breach detection. Null = within SLA or no SLA. */
  slaBreachedAt: Date | null;
  /**
   * Which approval step the request is currently waiting on (1-based).
   * Always 1 for single-step workflows. Incremented as each step is approved.
   */
  currentStep: number;
  /** Total steps required as defined by the TypeDef. 1 for single-step. Immutable after submit. */
  totalSteps: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface RequestApproval {
  id: string;
  requestId: string;
  step: number;
  approverId: string;
  decision: 'approved' | 'rejected' | 'delegated';
  note: string | null;
  /**
   * If the approver was acting as a delegate for another user, this records
   * the original delegator. Null = direct approval (most common case).
   */
  delegatedFromId: string | null;
  decidedAt: Date;
}

export interface RequestItemWithApprovals extends RequestItem {
  approvals: RequestApproval[];
  comments?: RequestComment[];
}

export interface SubmitRequestOptions {
  /** Absolute expiry time. Overrides TypeDef.defaultExpiryHours. */
  expiresAt?: Date;
  priority?: RequestPriority;
  /** ID of the employee who should review this request (overrides TypeDef resolver). */
  assigneeId?: string;
}

export interface RequestFilters {
  type?: string;
  requesterId?: string;
  assigneeId?: string;
  status?: RequestStatus;
  /** Return only requests the caller is the current assignee on. */
  myQueue?: boolean;
}

/**
 * Strategy interface: one implementation per request workflow type.
 *
 * `type` is the discriminator key. `requiredApprovalPermission` is checked
 * against the approver's effective RBAC grants before any approval is recorded.
 * Lifecycle hooks receive the same `tx` so side-effects are atomic.
 *
 * `onApprove` is required (creates domain records, e.g. access_grants).
 * All other hooks are optional; the engine handles the state transition itself.
 */
export interface RequestTypeDef<TPayload = Record<string, unknown>> {
  /** Unique discriminator, e.g. 'access_request' | 'leave_request' | 'overtime'. */
  readonly type: string;
  /** Permission key required of the approver, e.g. 'access_request.approve'. */
  readonly requiredApprovalPermission: string;
  /** When false (default), requester cannot approve their own request (SoD). */
  readonly allowSelfApproval?: boolean;
  /** Auto-expire after N hours with no decision. 0 = no expiry. */
  readonly defaultExpiryHours?: number;
  /**
   * SLA threshold in hours. If set, a `sla_deadline` is stored at submit time.
   * The SlaBreachCron notifies stakeholders when the deadline passes without a decision.
   * This is separate from expiry: SLA breach = notification only; expiry = auto-cancel.
   */
  readonly slaHours?: number;
  /**
   * Multi-step approval chain. When provided, overrides `requiredApprovalPermission`
   * (each step carries its own permission). Steps are processed in ascending step
   * number order. `onApprove` is called only when the **final** step is approved.
   *
   * If absent, falls back to single-step behavior using `requiredApprovalPermission`.
   */
  readonly approvalSteps?: ApprovalStepDef[];
  /** Called inside the submit transaction. Use for domain validation (e.g. overlap check). */
  onSubmit?(payload: TPayload, requesterId: string, tx: DbExecutor): Promise<void>;
  /** Called inside the approval transaction. REQUIRED: create domain records here. */
  onApprove(
    payload: TPayload,
    requestId: string,
    approverId: string,
    tx: DbExecutor,
  ): Promise<void>;
  /**
   * Called inside the transaction when an **intermediate** step is approved (not the final step).
   * Use to send notifications or perform intermediate domain actions.
   * The engine has already updated `currentStep` and `assigneeId` before calling this.
   */
  onStepApproved?(
    payload: TPayload,
    requestId: string,
    completedStep: number,
    nextStep: number,
    nextAssigneeId: string | null,
    approverId: string,
    tx: DbExecutor,
  ): Promise<void>;
  /** Called inside the rejection transaction. Update domain table status here. */
  onReject?(payload: TPayload, requestId: string, approverId: string, tx: DbExecutor): Promise<void>;
  /** Called inside the cancellation transaction. */
  onCancel?(payload: TPayload, requestId: string, cancelledBy: string, tx: DbExecutor): Promise<void>;
  /** Called inside the expiry transaction (from the worker's expiry cron). */
  onExpire?(payload: TPayload, requestId: string, tx: DbExecutor): Promise<void>;
  /**
   * Optional post-transaction hook called AFTER the approval transaction commits.
   * Use for external API calls (Graph, GitHub, etc.) that must not hold the DB tx open.
   * Failures are logged but do NOT roll back the already-committed DB state.
   */
  afterApprove?(payload: TPayload, requestId: string, approverId: string): Promise<void>;
}
