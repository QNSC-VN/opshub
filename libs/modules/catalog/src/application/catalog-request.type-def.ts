import { Injectable, OnModuleInit } from '@nestjs/common';
import { type DbExecutor, RequestRegistry, RequestTypeDef } from '@platform';
import { REQUEST_TYPE } from '@shared-kernel';

export interface CatalogRequestPayload extends Record<string, unknown> {
  /** The catalog item being requested. */
  catalogItemId: string;
  catalogItemName: string;
  /** Employee-provided reason / details for the request. */
  reason: string;
}

@Injectable()
export class CatalogRequestTypeDef
  implements RequestTypeDef<CatalogRequestPayload>, OnModuleInit
{
  readonly type = REQUEST_TYPE.CATALOG_REQUEST;
  readonly requiredApprovalPermission = 'requests.approve';
  readonly allowSelfApproval = false;
  readonly defaultExpiryHours = 72;
  readonly slaHours = 24;

  constructor(private readonly registry: RequestRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async onApprove(
    _payload: CatalogRequestPayload,
    _requestId: string,
    _approverId: string,
    _tx: DbExecutor,
  ): Promise<void> {
    // Fulfillment is manual (IT team action). No auto side-effects.
  }
}
