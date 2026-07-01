/**
 * Storage types — resource rules, DTOs, and lifecycle constants.
 *
 * RESOURCE_RULES drives validation at presign time:
 *   - allowedMimeTypes  — checked against the client-declared Content-Type
 *   - maxSizeBytes      — client declares size; HeadObject verifies on confirm
 */

const MB = 1024 * 1024;

export const RESOURCE_RULES = {
  /** Employee profile photo */
  'employee-avatar': {
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxSizeBytes: 5 * MB,
  },
  /** Physical asset inspection / inventory photo */
  'asset-photo': {
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxSizeBytes: 10 * MB,
  },
  /** Medical certificate or other leave supporting document */
  'leave-document': {
    allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
    maxSizeBytes: 10 * MB,
  },
  /** Access request justification document */
  'access-request-document': {
    allowedMimeTypes: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    maxSizeBytes: 10 * MB,
  },
  /** Compliance / audit report export (generated or uploaded) */
  'compliance-report': {
    allowedMimeTypes: [
      'application/pdf',
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    maxSizeBytes: 50 * MB,
  },
} as const;

export type ResourceType = keyof typeof RESOURCE_RULES;
export const VALID_RESOURCE_TYPES = Object.keys(RESOURCE_RULES) as ResourceType[];

/** Presigned PUT URL TTL — client must start the upload within this window. */
export const UPLOAD_URL_TTL_SECONDS = 300; // 5 min

/** Presigned GET URL TTL — short enough to limit a leaked URL's exposure window. */
export const DOWNLOAD_URL_TTL_SECONDS = 900; // 15 min

/** Orphaned `pending` files older than this are purged by StorageCleanupCron. */
export const ORPHAN_CUTOFF_HOURS = 24;

// ── Domain types ──────────────────────────────────────────────────────────────

export type StoredFileStatus = 'pending' | 'completed' | 'deleted';

export interface StoredFile {
  id: string;
  key: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  resourceType: string;
  status: StoredFileStatus;
  uploaderId: string;
  linkedEntityType: string | null;
  linkedEntityId: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
}

// ── Service I/O ───────────────────────────────────────────────────────────────

export interface PresignUploadInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  resourceType: ResourceType;
  /** Optional polymorphic link set at presign time so the cleanup cron can correlate orphans. */
  linkedEntityType?: string;
  linkedEntityId?: string;
}

export interface PresignUploadResult {
  fileId: string;
  uploadUrl: string;
  key: string;
}

export interface ConfirmUploadResult {
  fileId: string;
  key: string;
  /** CDN URL if configured, otherwise presigned S3 GET URL. */
  url: string;
}
