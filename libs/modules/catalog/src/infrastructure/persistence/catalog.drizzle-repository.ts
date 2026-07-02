import { Injectable } from '@nestjs/common';
import { eq, asc } from 'drizzle-orm';
import { InjectDrizzle, type DrizzleDB } from '@platform';
import { newId } from '@shared-kernel';
import { catalogItems } from '../../../../../../db/schema';
import type { ICatalogRepository } from '../../domain/ports/catalog.repository';
import type { CatalogItem, CreateCatalogItemInput, UpdateCatalogItemInput } from '../../domain/catalog.types';

@Injectable()
export class CatalogDrizzleRepository implements ICatalogRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async create(input: CreateCatalogItemInput): Promise<CatalogItem> {
    const [row] = await this.db
      .insert(catalogItems)
      .values({
        id: newId(),
        name: input.name,
        description: input.description ?? null,
        category: input.category,
        iconEmoji: input.iconEmoji ?? '📋',
        approvalPermission: input.approvalPermission,
        slaHours: input.slaHours ?? null,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning();
    return row;
  }

  async findById(id: string): Promise<CatalogItem | null> {
    const [row] = await this.db
      .select()
      .from(catalogItems)
      .where(eq(catalogItems.id, id))
      .limit(1);
    return row ?? null;
  }

  async list(includeInactive: boolean): Promise<CatalogItem[]> {
    const query = this.db.select().from(catalogItems).orderBy(asc(catalogItems.sortOrder), asc(catalogItems.name));
    if (!includeInactive) {
      return query.where(eq(catalogItems.isActive, true));
    }
    return query;
  }

  async update(id: string, input: UpdateCatalogItemInput): Promise<CatalogItem | null> {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) patch['name'] = input.name;
    if ('description' in input) patch['description'] = input.description;
    if (input.category !== undefined) patch['category'] = input.category;
    if ('iconEmoji' in input) patch['iconEmoji'] = input.iconEmoji;
    if (input.approvalPermission !== undefined) patch['approvalPermission'] = input.approvalPermission;
    if ('slaHours' in input) patch['slaHours'] = input.slaHours;
    if (input.isActive !== undefined) patch['isActive'] = input.isActive;
    if (input.sortOrder !== undefined) patch['sortOrder'] = input.sortOrder;

    const [row] = await this.db
      .update(catalogItems)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      .set(patch as any)
      .where(eq(catalogItems.id, id))
      .returning();
    return row ?? null;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(catalogItems).where(eq(catalogItems.id, id));
  }
}
