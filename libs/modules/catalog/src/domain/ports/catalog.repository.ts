import type { CatalogItem, CreateCatalogItemInput, UpdateCatalogItemInput } from '../catalog.types';

export const CATALOG_REPOSITORY = Symbol('CATALOG_REPOSITORY');

export interface ICatalogRepository {
  create(input: CreateCatalogItemInput): Promise<CatalogItem>;
  findById(id: string): Promise<CatalogItem | null>;
  list(includeInactive: boolean): Promise<CatalogItem[]>;
  update(id: string, input: UpdateCatalogItemInput): Promise<CatalogItem | null>;
  delete(id: string): Promise<void>;
}
