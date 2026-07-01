import { Inject, Injectable } from '@nestjs/common';
import {
  InjectDrizzle,
  type DrizzleDB,
  OutboxService,
  NotFoundException,
  ConflictException,
  PreconditionFailedException,
  ErrorCodes,
  StorageService,
} from '@platform';
import type { PresignUploadResult, ConfirmUploadResult } from '@platform';
import { AuditService } from '@modules/audit';
import { EmployeeService } from '@modules/identity';
import { ASSET_REPOSITORY, type IAssetRepository } from '../domain/ports/asset.repository';
import type { Asset, AssetAssignment, AssetFilters, CreateAssetInput } from '../domain/asset.types';

@Injectable()
export class AssetService {
  constructor(
    @Inject(ASSET_REPOSITORY) private readonly assetRepo: IAssetRepository,
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly outbox: OutboxService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly employees: EmployeeService,
  ) {}

  async create(input: CreateAssetInput, actor: { sub: string; email: string }): Promise<Asset> {
    const existing = await this.assetRepo.findByTag(input.assetTag);
    if (existing) {
      throw new ConflictException(ErrorCodes.ASSET_TAG_TAKEN, `Asset tag ${input.assetTag} is taken`);
    }
    const asset = await this.assetRepo.create(input);
    await this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'asset.created',
      resourceType: 'asset',
      resourceId: asset.id,
      metadata: { assetTag: asset.assetTag, type: asset.type },
    });
    return asset;
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
      await this.outbox.enqueue(tx, {
        aggregateType: 'asset',
        aggregateId: assetId,
        eventType: 'asset.assigned',
        payload: { assetId, employeeId },
      });
    });

    await this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'asset.assigned',
      resourceType: 'asset',
      resourceId: assetId,
      metadata: { employeeId },
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
      await this.outbox.enqueue(tx, {
        aggregateType: 'asset',
        aggregateId: assetId,
        eventType: 'asset.unassigned',
        payload: { assetId, previousEmployeeId: asset.assignedTo },
      });
    });

    await this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'asset.unassigned',
      resourceType: 'asset',
      resourceId: assetId,
    });
    return this.getById(assetId);
  }

  async retire(assetId: string, actor: { sub: string; email: string }): Promise<Asset> {
    const asset = await this.getById(assetId);
    if (asset.status === 'retired') {
      throw new PreconditionFailedException(ErrorCodes.ASSET_RETIRED, 'Asset is already retired');
    }
    if (asset.status === 'assigned') {
      throw new PreconditionFailedException(ErrorCodes.ASSET_ALREADY_ASSIGNED, 'Cannot retire an assigned asset — unassign it first');
    }
    await this.assetRepo.retire(assetId);
    await this.db.transaction(async (tx) => {
      await this.outbox.enqueue(tx, {
        aggregateType: 'asset',
        aggregateId: assetId,
        eventType: 'asset.retired',
        payload: { assetId },
      });
    });
    await this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'asset.retired',
      resourceType: 'asset',
      resourceId: assetId,
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
      const old = await this.storage.findById(asset.photoStorageKey);
      if (old) void this.storage.deleteFile(old.id, old.uploaderId);
    }

    await this.assetRepo.updatePhoto(assetId, result.key);

    void this.audit.record({
      actorId: actor.sub,
      actorEmail: actor.email,
      action: 'asset.photo_updated',
      resourceType: 'asset',
      resourceId: assetId,
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
