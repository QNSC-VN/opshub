import type { DbExecutor } from '@platform';
import type { Asset, AssetAssignment, AssetFilters, CreateAssetInput } from '../asset.types';

export const ASSET_REPOSITORY = Symbol('ASSET_REPOSITORY');

export interface IAssetRepository {
  create(input: CreateAssetInput): Promise<Asset>;
  findById(id: string, tx?: DbExecutor): Promise<Asset | null>;
  findByTag(assetTag: string): Promise<Asset | null>;
  list(filters: AssetFilters, limit: number, offset: number): Promise<{ rows: Asset[]; total: number }>;

  /** Set asset assigned to an employee + open an assignment row (within tx). */
  assign(assetId: string, employeeId: string, notes: string | null, tx: DbExecutor): Promise<void>;
  /** Clear assignment + close the open assignment row (within tx). */
  unassign(assetId: string, tx: DbExecutor): Promise<void>;
  /** Mark asset retired. */
  retire(assetId: string): Promise<void>;

  listAssignments(assetId: string): Promise<AssetAssignment[]>;

  /** Update the S3 object key for the asset photo. Pass null to clear. */
  updatePhoto(assetId: string, photoStorageKey: string | null): Promise<void>;
}
