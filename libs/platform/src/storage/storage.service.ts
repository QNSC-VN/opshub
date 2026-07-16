import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { eq, and, lt } from 'drizzle-orm';
import { InjectDrizzle, type DrizzleDB } from '../database/index';
import { AppConfigService } from '../config/app-config.service';
import { ResilienceService } from '../resilience/resilience.service';
import { NotFoundException, ValidationException } from '../errors/exceptions';
import { ErrorCodes } from '../errors/error-codes';
import { Span } from '../observability/span.decorator';
import { storedFiles } from '../../../../db/schema';
import { newId } from '../../../shared-kernel/src/index';
import type {
  StoredFile,
  PresignUploadInput,
  PresignUploadResult,
  ConfirmUploadResult,
} from './storage.types';
import {
  RESOURCE_RULES,
  UPLOAD_URL_TTL_SECONDS,
  DOWNLOAD_URL_TTL_SECONDS,
  ORPHAN_CUTOFF_HOURS,
} from './storage.types';

/**
 * Platform-level storage service — S3 presigned PUT/GET + DB lifecycle tracking.
 *
 * Flow:
 *   1. presignUpload()  — validate, create storedFile(pending), return S3 PUT URL
 *   2. client PUTs file directly to S3 using the signed URL
 *   3. confirmUpload()  — HeadObject, verify size, update storedFile(completed)
 *   4. getDownloadUrl() — presignGet for time-limited read access
 *   5. deleteFile()     — soft-delete DB row + best-effort S3 delete
 *
 * Registered as a global provider via PlatformModule.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly cdnBaseUrl: string | null;

  constructor(
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly config: AppConfigService,
    private readonly resilience: ResilienceService,
  ) {
    this.bucket = config.get('S3_FILES_BUCKET') ?? '';
    this.cdnBaseUrl = (config.get('CDN_FILES_BASE_URL') ?? '').replace(/\/$/, '') || null;

    // endpoint set → S3-compatible backend (Cloudflare R2, MinIO) with static
    // credentials and path-style addressing. Same SDK, selected by config.
    const endpoint = config.get('STORAGE_ENDPOINT');
    const accessKeyId = config.get('STORAGE_ACCESS_KEY_ID');
    const secretAccessKey = config.get('STORAGE_SECRET_ACCESS_KEY');

    this.s3 = new S3Client({
      region: endpoint ? 'auto' : config.get('AWS_REGION'),
      ...(endpoint ? { endpoint, forcePathStyle: config.get('STORAGE_FORCE_PATH_STYLE') } : {}),
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    });
  }

  /**
   * Step 1: Validate the upload request, record a pending DB row, and return a
   * presigned S3 PUT URL.  The client should PUT the file to `uploadUrl` within
   * UPLOAD_URL_TTL_SECONDS (5 min).
   */
  @Span('storage.presignUpload')
  async presignUpload(input: PresignUploadInput, uploaderId: string): Promise<PresignUploadResult> {
    const rules = RESOURCE_RULES[input.resourceType];
    if (!rules) {
      throw new ValidationException(
        ErrorCodes.FILE_TYPE_NOT_ALLOWED,
        `Unknown resource type: ${input.resourceType}`,
      );
    }

    if (!(rules.allowedMimeTypes as readonly string[]).includes(input.mimeType)) {
      throw new ValidationException(
        ErrorCodes.FILE_TYPE_NOT_ALLOWED,
        `MIME type ${input.mimeType} not allowed for ${input.resourceType}. Allowed: ${rules.allowedMimeTypes.join(', ')}`,
      );
    }

    if (input.sizeBytes > rules.maxSizeBytes) {
      throw new ValidationException(
        ErrorCodes.FILE_TOO_LARGE,
        `File size ${input.sizeBytes} exceeds the ${rules.maxSizeBytes} byte limit for ${input.resourceType}`,
      );
    }

    const ext = input.fileName.includes('.')
      ? `.${input.fileName.split('.').pop()!.toLowerCase()}`
      : '';
    const key = `${input.resourceType}/${uploaderId}/${newId()}${ext}`;

    const [file] = await this.db
      .insert(storedFiles)
      .values({
        id: newId(),
        key,
        originalName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        resourceType: input.resourceType,
        status: 'pending',
        uploaderId,
        linkedEntityType: input.linkedEntityType ?? null,
        linkedEntityId: input.linkedEntityId ?? null,
      })
      .returning();

    const uploadUrl = await this.resilience.execute('s3.presignPut', this.resilience.external, () =>
      getSignedUrl(
        this.s3,
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ContentType: input.mimeType,
          ContentLength: input.sizeBytes,
        }),
        { expiresIn: UPLOAD_URL_TTL_SECONDS },
      ),
    );

    return { fileId: file.id, uploadUrl, key };
  }

  /**
   * Step 3: Verify the file was actually uploaded (HeadObject) and mark it
   * completed.  Idempotent — returns current state if already confirmed.
   */
  @Span('storage.confirmUpload')
  async confirmUpload(fileId: string, uploaderId: string): Promise<ConfirmUploadResult> {
    const [file] = await this.db
      .select()
      .from(storedFiles)
      .where(and(eq(storedFiles.id, fileId), eq(storedFiles.uploaderId, uploaderId)))
      .limit(1);

    if (!file) {
      throw new NotFoundException(ErrorCodes.FILE_NOT_FOUND, 'Stored file not found');
    }

    // Idempotent — already confirmed
    if (file.status === 'completed') {
      return { fileId: file.id, key: file.key, url: this.resolveUrl(file.key) };
    }

    if (file.status === 'deleted') {
      throw new ValidationException(ErrorCodes.FILE_NOT_FOUND, 'This file has been deleted');
    }

    const head = await this.headObject(file.key);
    if (!head) {
      throw new ValidationException(
        ErrorCodes.FILE_NOT_UPLOADED,
        'File not found in storage. Upload the file to the presigned URL first.',
      );
    }

    if (head.contentLength !== file.sizeBytes) {
      // Size mismatch — mark deleted so the orphan cron can purge the S3 object
      await this.db
        .update(storedFiles)
        .set({ status: 'deleted' })
        .where(eq(storedFiles.id, fileId));
      throw new ValidationException(
        ErrorCodes.FILE_SIZE_MISMATCH,
        `Uploaded size (${head.contentLength}) does not match declared size (${file.sizeBytes})`,
      );
    }

    const [updated] = await this.db
      .update(storedFiles)
      .set({ status: 'completed', confirmedAt: new Date() })
      .where(eq(storedFiles.id, fileId))
      .returning();

    return { fileId: updated.id, key: updated.key, url: this.resolveUrl(updated.key) };
  }

  /**
   * Get a time-limited download URL.  Uses CDN base URL when configured,
   * otherwise falls back to a presigned S3 GET URL (15 min TTL).
   */
  @Span('storage.getDownloadUrl')
  async getDownloadUrl(fileId: string): Promise<string> {
    const [file] = await this.db
      .select()
      .from(storedFiles)
      .where(and(eq(storedFiles.id, fileId), eq(storedFiles.status, 'completed')))
      .limit(1);

    if (!file) {
      throw new NotFoundException(ErrorCodes.FILE_NOT_FOUND, 'File not found or not yet confirmed');
    }

    return this.resolveUrl(file.key);
  }

  /**
   * Soft-delete the DB row and best-effort delete from S3.
   * S3 delete errors are logged but NOT re-thrown — the DB row is already gone.
   */
  @Span('storage.deleteFile')
  async deleteFile(fileId: string, uploaderId: string): Promise<void> {
    const [file] = await this.db
      .select()
      .from(storedFiles)
      .where(and(eq(storedFiles.id, fileId), eq(storedFiles.uploaderId, uploaderId)))
      .limit(1);

    if (!file) {
      throw new NotFoundException(ErrorCodes.FILE_NOT_FOUND, 'Stored file not found');
    }

    await this.db.update(storedFiles).set({ status: 'deleted' }).where(eq(storedFiles.id, fileId));

    void this.s3
      .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: file.key }))
      .catch((err: unknown) =>
        this.logger.error({ key: file.key, err }, 'S3 delete failed — manual cleanup needed'),
      );
  }

  /**
   * Purge orphaned pending uploads older than ORPHAN_CUTOFF_HOURS hours.
   * Called by StorageCleanupCron — returns number of rows deleted.
   */
  async purgeOrphanedUploads(): Promise<number> {
    const cutoff = new Date(Date.now() - ORPHAN_CUTOFF_HOURS * 3_600_000);
    const rows = await this.db
      .select({ id: storedFiles.id, key: storedFiles.key })
      .from(storedFiles)
      .where(and(eq(storedFiles.status, 'pending'), lt(storedFiles.createdAt, cutoff)));

    if (rows.length === 0) return 0;

    // Best-effort S3 deletes — do not block on individual failures
    await Promise.allSettled(
      rows.map((r) =>
        this.s3
          .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: r.key }))
          .catch((err: unknown) =>
            this.logger.warn({ key: r.key, err }, 'Orphan S3 delete failed'),
          ),
      ),
    );

    await this.db
      .update(storedFiles)
      .set({ status: 'deleted' })
      .where(and(eq(storedFiles.status, 'pending'), lt(storedFiles.createdAt, cutoff)));

    return rows.length;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async headObject(key: string): Promise<{ contentLength: number } | null> {
    try {
      const result = await this.resilience.execute('s3.headObject', this.resilience.external, () =>
        this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })),
      );
      return { contentLength: result.ContentLength ?? 0 };
    } catch {
      return null;
    }
  }

  private resolveUrl(key: string): string {
    if (this.cdnBaseUrl) {
      return `${this.cdnBaseUrl}/${key}`;
    }
    // Presigned GET — generated lazily; in dev we return a placeholder path
    // since S3_FILES_BUCKET may not be configured.
    if (!this.bucket) return `/dev/files/${key}`;
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: DOWNLOAD_URL_TTL_SECONDS,
    }) as unknown as string;
  }

  /** Presigned GET URL for a known key — used by domain services that already hold the key. */
  async presignGet(key: string): Promise<string> {
    if (this.cdnBaseUrl) return `${this.cdnBaseUrl}/${key}`;
    if (!this.bucket) return `/dev/files/${key}`;
    return this.resilience.execute('s3.presignGet', this.resilience.external, () =>
      getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
        expiresIn: DOWNLOAD_URL_TTL_SECONDS,
      }),
    );
  }

  /** Expose a stored file record by id (for domain services to link after confirm). */
  async findById(fileId: string): Promise<StoredFile | null> {
    const [row] = await this.db
      .select()
      .from(storedFiles)
      .where(eq(storedFiles.id, fileId))
      .limit(1);
    return row ?? null;
  }
}
