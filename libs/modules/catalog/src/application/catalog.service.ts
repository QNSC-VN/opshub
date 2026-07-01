import { Inject, Injectable } from '@nestjs/common';
import { NotFoundException, ErrorCodes, RequestEngine } from '@platform';
import { REQUEST_TYPE, AUDIT_ACTION } from '@shared-kernel';
import { AuditService } from '@modules/audit';
import { CATALOG_REPOSITORY, type ICatalogRepository } from '../domain/ports/catalog.repository';
import type { CatalogItem, CreateCatalogItemInput, UpdateCatalogItemInput } from '../domain/catalog.types';

type Actor = { sub: string; email: string };

@Injectable()
export class CatalogService {
  constructor(
    @Inject(CATALOG_REPOSITORY) private readonly repo: ICatalogRepository,
    private readonly engine: RequestEngine,
    private readonly audit: AuditService,
  ) {}

  async createItem(input: CreateCatalogItemInput, actor: Actor): Promise<CatalogItem> {
    const item = await this.repo.create(input);
    await this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'catalog.item_created',
      resourceType: 'catalog_item',
      resourceId: item.id,
      metadata: { name: item.name, category: item.category },
    });
    return item;
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
    const updated = await this.repo.update(id, input);
    if (!updated) throw new NotFoundException(ErrorCodes.NOT_FOUND, 'Catalog item not found');
    await this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'catalog.item_updated',
      resourceType: 'catalog_item',
      resourceId: id,
    });
    return updated;
  }

  async deleteItem(id: string, actor: Actor): Promise<void> {
    await this.getItem(id);
    await this.repo.delete(id);
    await this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'catalog.item_deleted',
      resourceType: 'catalog_item',
      resourceId: id,
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
        ...(item.slaHours && { expiresAt: new Date(Date.now() + item.slaHours * 3600 * 1000) }),
      },
    );

    await this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'catalog.request_submitted',
      resourceType: 'catalog_request',
      resourceId: engineItem.id,
      metadata: { catalogItemId, catalogItemName: item.name, reason },
    });

    return { requestId: engineItem.id };
  }
}
