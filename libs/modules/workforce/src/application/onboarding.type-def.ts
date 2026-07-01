import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { type DbExecutor, InjectDrizzle, type DrizzleDB, RequestRegistry, RequestTypeDef } from '@platform';
import { REQUEST_TYPE } from '@shared-kernel';
import { employees } from '../../../../../db/schema';
import { GraphProvisioningService } from './graph-provisioning.service';

export interface OnboardingPayload extends Record<string, unknown> {
  /** The employee being onboarded. */
  employeeId: string;
  employeeEmail: string;
  /** Requested start date (YYYY-MM-DD). */
  startDate: string;
  department?: string;
  jobTitle?: string;
  managerName?: string;
  equipmentType?: string;
  preferredOs?: string;
  equipmentNote?: string;
  accessNeeds?: string[];
}

/**
 * Three-step onboarding workflow:
 *   Step 1 — Manager approves the hire          (onboarding.approve)
 *   Step 2 — IT provisions access + equipment   (onboarding.provision)
 *   Step 3 — HR marks onboarding complete       (onboarding.complete)
 *
 * The engine handles all state transitions. `onApprove` is intentionally a
 * no-op because the employee is already `active` — all domain work (RBAC,
 * provisioning) happens out-of-band; the audit event is recorded by the
 * controller after `engine.submit` returns.
 */
@Injectable()
export class OnboardingTypeDef
  implements RequestTypeDef<OnboardingPayload>, OnModuleInit
{
  private readonly logger = new Logger(OnboardingTypeDef.name);

  readonly type = REQUEST_TYPE.ONBOARDING;
  /** Fallback for single-step compatibility; not used in multi-step mode. */
  readonly requiredApprovalPermission = 'onboarding.complete';
  readonly allowSelfApproval = false;
  readonly defaultExpiryHours = 168; // 7 days
  readonly slaHours = 72; // 3 business days end-to-end

  readonly approvalSteps = [
    { step: 1, requiredPermission: 'onboarding.approve' },
    { step: 2, requiredPermission: 'onboarding.provision' },
    { step: 3, requiredPermission: 'onboarding.complete' },
  ];

  constructor(
    private readonly registry: RequestRegistry,
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly graphProvisioning: GraphProvisioningService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async onApprove(_payload: OnboardingPayload, _requestId: string, _approverId: string, _tx: DbExecutor): Promise<void> {
    // No domain side-effects needed on final approval.
    // The controller records the audit event after the engine call returns.
  }

  async afterApprove(payload: OnboardingPayload): Promise<void> {
    if (!this.graphProvisioning.isEnabled()) return;

    const [row] = await this.db
      .select({ entraOid: employees.entraOid })
      .from(employees)
      .where(eq(employees.id, payload.employeeId))
      .limit(1);

    if (!row?.entraOid) {
      this.logger.warn(`Onboarding afterApprove: no Entra OID for employee ${payload.employeeId}, skipping Graph enable`);
      return;
    }

    await this.graphProvisioning.enableEntraUser(row.entraOid);
  }
}
