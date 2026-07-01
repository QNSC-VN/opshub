/**
 * storage schema — lifecycle-tracked file records for presigned S3 uploads.
 *
 * Every upload goes through three states:
 *   pending   — presign issued, client has not yet PUT to S3
 *   completed — confirmUpload verified the object exists in S3
 *   deleted   — soft-deleted (S3 object purged asynchronously)
 *
 * The StorageCleanupCron purges rows that remain `pending` for > 24 h (orphaned
 * uploads where the client started but never finished).
 */
import { pgSchema, uuid, varchar, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { storedFileStatusEnum } from './enums';

export const storageSchema = pgSchema('storage');

export const storedFiles = storageSchema.table(
  'stored_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** S3 object key — globally unique path within the bucket. */
    key: varchar('key', { length: 512 }).notNull(),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 127 }).notNull(),
    /** Declared size at presign time; verified against HeadObject on confirm. */
    sizeBytes: integer('size_bytes').notNull(),
    /** Domain-scoped bucket prefix, e.g. 'employee-avatar', 'asset-photo'. */
    resourceType: varchar('resource_type', { length: 64 }).notNull(),
    status: storedFileStatusEnum('status').notNull().default('pending'),
    /** Employee id who initiated the upload. */
    uploaderId: uuid('uploader_id').notNull(),
    /** Polymorphic link so a cleanup query can find orphans by entity. */
    linkedEntityType: varchar('linked_entity_type', { length: 64 }),
    linkedEntityId: uuid('linked_entity_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index('ix_stored_file_status').on(t.status),
    uploaderIdx: index('ix_stored_file_uploader').on(t.uploaderId),
    entityIdx: index('ix_stored_file_entity').on(t.linkedEntityType, t.linkedEntityId),
    createdIdx: index('ix_stored_file_created').on(t.createdAt),
  }),
);
