import { Inject, Injectable } from '@nestjs/common';
import {
  NotFoundException,
  ErrorCodes,
  InjectDrizzle,
  RequestEngine,
  type DrizzleDB,
} from '@platform';
import { MS_PER_HOUR, REQUEST_TYPE, type Actor } from '@shared-kernel';
import {
  AuditService,
  AUDIT_ACTION,
  AUDIT_RESOURCE,
  type ResourceAuditTrail,
} from '@modules/audit';
import { CATALOG_REPOSITORY, type ICatalogRepository } from '../domain/ports/catalog.repository';
import type {
  CatalogItem,
  CreateCatalogItemInput,
  UpdateCatalogItemInput,
} from '../domain/catalog.types';

/**
 * The service catalogue, and the requests raised against it.
 *
 * AUDIT ENTRIES SHARE THEIR MUTATION'S TRANSACTION. Item writes were fire-and-forget, so the catalogue could
 * change — including a DELETE — with nothing in the trail.
 *
 * THE REQUEST SUBMISSION IS THE EXCEPTION, and stays outside one: `RequestEngine.submit` owns its own write in
 * `libs/platform` and returns the id the entry describes, so there is no transaction of ours to join. Recorded
 * immediately after, which is the same guarantee the engine's own row gives.
 */
@Injectable()
export class CatalogService {
  private readonly itemTrail: ResourceAuditTrail;
  private readonly requestTrail: ResourceAuditTrail;

  constructor(
    @Inject(CATALOG_REPOSITORY) private readonly repo: ICatalogRepository,
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly engine: RequestEngine,
    audit: AuditService,
  ) {
    this.itemTrail = audit.forResource(AUDIT_RESOURCE.CATALOG_ITEM);
    this.requestTrail = audit.forResource(AUDIT_RESOURCE.CATALOG_REQUEST);
  }

  async createItem(input: CreateCatalogItemInput, actor: Actor): Promise<CatalogItem> {
    return this.db.transaction(async (tx) => {
      const item = await this.repo.create(input, tx);
      await this.itemTrail.record(AUDIT_ACTION.CATALOG_ITEM_CREATED, item.id, actor, tx, {
        after: { name: item.name, category: item.category },
      });
      return item;
    });
  }

  async getItem(id: string): Promise<CatalogItem> {
    const item = await this.repo.findById(id);
    if (!item) throw new NotFoundException(ErrorCodes.NOT_FOUND, 'Catalog item not found');
    return item;
  }

  async listItems(includeInactive = false): Promise<CatalogItem[]> {
    return this.repo.list(includeInactive);
  }

  async updateItem(id: string, input: UpdateCatalogItemInput, actor: Actor): Promise<CatalogItem> {
    await this.getItem(id);
    return this.db.transaction(async (tx) => {
      const updated = await this.repo.update(id, input, tx);
      if (!updated) throw new NotFoundException(ErrorCodes.NOT_FOUND, 'Catalog item not found');
      await this.itemTrail.record(AUDIT_ACTION.CATALOG_ITEM_UPDATED, id, actor, tx, {
        after: input,
      });
      return updated;
    });
  }

  async deleteItem(id: string, actor: Actor): Promise<void> {
    await this.getItem(id);
    // A hard delete, so the entry is the ONLY record the item ever existed: it cannot be fire-and-forget.
    await this.db.transaction(async (tx) => {
      await this.repo.delete(id, tx);
      await this.itemTrail.record(AUDIT_ACTION.CATALOG_ITEM_DELETED, id, actor, tx, {});
    });
  }

  async submitRequest(
    catalogItemId: string,
    reason: string,
    actor: Actor,
  ): Promise<{ requestId: string }> {
    const item = await this.getItem(catalogItemId);
    if (!item.isActive) {
      throw new NotFoundException(ErrorCodes.NOT_FOUND, 'Catalog item not found or inactive');
    }

    const engineItem = await this.engine.submit(
      REQUEST_TYPE.CATALOG_REQUEST,
      { catalogItemId: item.id, catalogItemName: item.name, reason },
      actor,
      {
        ...(item.slaHours && { expiresAt: new Date(Date.now() + item.slaHours * MS_PER_HOUR) }),
      },
    );

    // No transaction of ours to join — see the note on the class.
    await this.requestTrail.record(
      AUDIT_ACTION.CATALOG_REQUEST_SUBMITTED,
      engineItem.id,
      actor,
      undefined,
      { after: { catalogItemId, catalogItemName: item.name, reason } },
    );

    return { requestId: engineItem.id };
  }
}
