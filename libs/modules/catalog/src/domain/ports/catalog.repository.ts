import type { DbExecutor } from '@platform';
import type { CatalogItem, CreateCatalogItemInput, UpdateCatalogItemInput } from '../catalog.types';

export const CATALOG_REPOSITORY = Symbol('CATALOG_REPOSITORY');

export interface ICatalogRepository {
  create(input: CreateCatalogItemInput, tx?: DbExecutor): Promise<CatalogItem>;
  findById(id: string): Promise<CatalogItem | null>;
  list(includeInactive: boolean): Promise<CatalogItem[]>;
  update(id: string, input: UpdateCatalogItemInput, tx?: DbExecutor): Promise<CatalogItem | null>;
  delete(id: string, tx?: DbExecutor): Promise<void>;
}
