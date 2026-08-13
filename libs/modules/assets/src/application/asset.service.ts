import { Inject, Injectable } from '@nestjs/common';
import {
  InjectDrizzle,
  type DrizzleDB,
  NotFoundException,
  ConflictException,
  PreconditionFailedException,
  ErrorCodes,
  StorageService,
} from '@platform';
import type { PresignUploadResult } from '@platform';
import {
  AuditService,
  AUDIT_ACTION,
  AUDIT_RESOURCE,
  type ResourceAuditTrail,
} from '@modules/audit';
import { EmployeeService } from '@modules/identity';
import { ASSET_REPOSITORY, type IAssetRepository } from '../domain/ports/asset.repository';
import type { Asset, AssetAssignment, AssetFilters, CreateAssetInput } from '../domain/asset.types';

/**
 * Assets, their assignments, and their photos.
 *
 * EVERY AUDIT ENTRY SHARES ITS MUTATION'S TRANSACTION — assign and unassign already did, and create, retire
 * and the photo writes now do too. They were a fire-and-forget `audit.record` call, which meant an asset could be
 * created or retired with nothing in the trail. The entry commits with the row or not at all.
 *
 * DELETING THE OLD PHOTO FROM S3 STAYS OUTSIDE, because Postgres cannot roll back an S3 delete: the object is
 * soft-deleted first and the column is updated in the transaction, so the worst case is an orphaned object
 * rather than a row pointing at nothing.
 */
@Injectable()
export class AssetService {
  private readonly trail: ResourceAuditTrail;

  constructor(
    @Inject(ASSET_REPOSITORY) private readonly assetRepo: IAssetRepository,
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly storage: StorageService,
    audit: AuditService,
    private readonly employees: EmployeeService,
  ) {
    this.trail = audit.forResource(AUDIT_RESOURCE.ASSET);
  }

  async create(input: CreateAssetInput, actor: { sub: string; email: string }): Promise<Asset> {
    const existing = await this.assetRepo.findByTag(input.assetTag);
    if (existing) {
      throw new ConflictException(
        ErrorCodes.ASSET_TAG_TAKEN,
        `Asset tag ${input.assetTag} is taken`,
      );
    }
    return this.db.transaction(async (tx) => {
      const asset = await this.assetRepo.create(input, tx);
      await this.trail.record(AUDIT_ACTION.ASSET_CREATED, asset.id, actor, tx, {
        after: { assetTag: asset.assetTag, type: asset.type },
      });
      return asset;
    });
  }

  async getById(id: string): Promise<Asset> {
    const asset = await this.assetRepo.findById(id);
    if (!asset) throw new NotFoundException(ErrorCodes.ASSET_NOT_FOUND, 'Asset not found');
    return asset;
  }

  async list(
    filters: AssetFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: Asset[]; total: number }> {
    return this.assetRepo.list(filters, limit, offset);
  }

  async assign(
    assetId: string,
    employeeId: string,
    notes: string | null,
    actor: { sub: string; email: string },
  ): Promise<Asset> {
    const asset = await this.getById(assetId);
    if (asset.status === 'retired' || asset.status === 'lost') {
      throw new PreconditionFailedException(ErrorCodes.ASSET_RETIRED, 'Asset cannot be assigned');
    }
    if (asset.assignedTo) {
      throw new ConflictException(ErrorCodes.ASSET_ALREADY_ASSIGNED, 'Asset is already assigned');
    }
    // Validates the employee exists (throws EMPLOYEE_NOT_FOUND otherwise).
    await this.employees.getById(employeeId);

    await this.db.transaction(async (tx) => {
      await this.assetRepo.assign(assetId, employeeId, notes, tx);
      await this.trail.record(AUDIT_ACTION.ASSET_ASSIGNED, assetId, actor, tx, {
        after: { assignedTo: employeeId },
      });
    });
    return this.getById(assetId);
  }

  async unassign(assetId: string, actor: { sub: string; email: string }): Promise<Asset> {
    const asset = await this.getById(assetId);
    if (!asset.assignedTo) {
      throw new PreconditionFailedException(ErrorCodes.ASSET_NOT_ASSIGNED, 'Asset is not assigned');
    }

    await this.db.transaction(async (tx) => {
      await this.assetRepo.unassign(assetId, tx);
      await this.trail.record(AUDIT_ACTION.ASSET_UNASSIGNED, assetId, actor, tx, {
        before: { assignedTo: asset.assignedTo },
      });
    });
    return this.getById(assetId);
  }

  async retire(assetId: string, actor: { sub: string; email: string }): Promise<Asset> {
    const asset = await this.getById(assetId);
    if (asset.status === 'retired') {
      throw new PreconditionFailedException(ErrorCodes.ASSET_RETIRED, 'Asset is already retired');
    }
    if (asset.status === 'assigned') {
      throw new PreconditionFailedException(
        ErrorCodes.ASSET_ALREADY_ASSIGNED,
        'Cannot retire an assigned asset — unassign it first',
      );
    }
    await this.db.transaction(async (tx) => {
      await this.assetRepo.retire(assetId, tx);
      await this.trail.record(AUDIT_ACTION.ASSET_RETIRED, assetId, actor, tx, {
        before: { status: asset.status },
        after: { status: 'retired' },
      });
    });
    return this.getById(assetId);
  }

  async listAssignments(assetId: string): Promise<AssetAssignment[]> {
    await this.getById(assetId);
    return this.assetRepo.listAssignments(assetId);
  }

  // ── Photo upload ──────────────────────────────────────────────────────────

  /** Step 1 — returns a presigned S3 PUT URL for the client to upload to. */
  async presignPhoto(
    assetId: string,
    input: { fileName: string; mimeType: string; sizeBytes: number },
    actor: { sub: string; email: string },
  ): Promise<PresignUploadResult> {
    await this.getById(assetId); // 404 guard
    return this.storage.presignUpload(
      {
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        resourceType: 'asset-photo',
        linkedEntityType: 'asset',
        linkedEntityId: assetId,
      },
      actor.sub,
    );
  }

  /** Step 3 — verify upload and link the S3 key to the asset row. */
  async confirmPhoto(
    assetId: string,
    fileId: string,
    actor: { sub: string; email: string },
  ): Promise<{ photoUrl: string }> {
    const asset = await this.getById(assetId);
    const result = await this.storage.confirmUpload(fileId, actor.sub);

    // Soft-delete previous photo if one exists
    if (asset.photoStorageKey) {
      const old = await this.storage.findByKey(asset.photoStorageKey);
      if (old) void this.storage.deleteFile(old.id, old.uploaderId);
    }

    await this.db.transaction(async (tx) => {
      await this.assetRepo.updatePhoto(assetId, result.key, tx);
      await this.trail.record(AUDIT_ACTION.ASSET_PHOTO_UPDATED, assetId, actor, tx, {});
    });

    return { photoUrl: result.url };
  }

  /** Returns a time-limited download URL for the asset photo. */
  async getPhotoUrl(assetId: string): Promise<{ photoUrl: string | null }> {
    const asset = await this.getById(assetId);
    if (!asset.photoStorageKey) return { photoUrl: null };
    const url = await this.storage.presignGet(asset.photoStorageKey);
    return { photoUrl: url };
  }
}
