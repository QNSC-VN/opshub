/**
 * documents schema — controlled documents: ISMS policies, QMS procedures, EMS handbooks.
 *
 * ONE PRIMITIVE, THREE CONSUMERS. A policy, an SOP and a staff handbook differ in who approves
 * them and what they say, not in their lifecycle: each is drafted, approved, published,
 * acknowledged by the people it binds, reviewed on a schedule, and eventually superseded. Three
 * separate schemas would make "which employees have not acknowledged the current version of
 * anything?" a query nobody can write.
 *
 * THE SHAPE THAT CARRIES THE RULES
 * --------------------------------
 * `documents` is the stable identity — a code like `POL-001` that outlives every revision, so a
 * cross-reference from a risk or a control never breaks.
 *
 * `document_versions` is where content lives, and versions are IMMUTABLE once published. Editing a
 * published document means a new version, because ISO 9001 §7.5 and ISO 27001 §7.5 both require
 * knowing which revision was in force on a given date — and an in-place edit destroys exactly
 * that. A `published_at` that is set is the marker of immutability.
 *
 * `document_acknowledgements` is per VERSION, not per document. This is the rule most
 * implementations get wrong: acknowledging v1 says nothing about v2, so when a policy changes
 * materially everyone must acknowledge again. Keying the table on the document would silently
 * carry an old consent forward.
 */
import {
  pgSchema,
  uuid,
  varchar,
  text,
  integer,
  date,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { documentCategoryEnum, documentVersionStatusEnum } from './enums';

export const documentsSchema = pgSchema('documents');

export const documents = documentsSchema.table(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Human-facing identifier (`POL-001`, `SOP-014`). Unique and stable across revisions: an
     * auditor asks for "POL-001", never for a uuid, and a control that cites it must keep
     * resolving after ten revisions.
     */
    code: varchar('code', { length: 32 }).notNull(),
    title: varchar('title', { length: 240 }).notNull(),
    /** Which management system this belongs to — the only thing separating a policy from an SOP. */
    category: documentCategoryEnum('category').notNull(),
    /** Employee accountable for the content and for answering review reminders. */
    ownerId: uuid('owner_id').notNull(),
    /**
     * Retired documents stay readable. A superseded control still has to be explainable years
     * later, so this is a soft retirement, never a delete.
     */
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeIdx: uniqueIndex('uq_document_code').on(t.code),
    categoryIdx: index('ix_document_category').on(t.category),
    ownerIdx: index('ix_document_owner').on(t.ownerId),
  }),
);

export const documentVersions = documentsSchema.table(
  'document_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    /** 1, 2, 3 … unique per document. Not semver: a controlled document has revisions, not releases. */
    version: integer('version').notNull(),
    /** The content itself, or a storage key when it is an uploaded file. */
    body: text('body'),
    storageKey: varchar('storage_key', { length: 512 }),
    /** What changed since the previous version — required reading for anyone re-acknowledging. */
    changeSummary: text('change_summary'),
    status: documentVersionStatusEnum('status').notNull().default('draft'),
    /** Engine request driving the approval, once submitted. */
    requestId: uuid('request_id'),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    /**
     * Set when this version becomes the one in force. Its presence is what makes the row
     * immutable, and `uq_document_published_version` makes "one published version per document"
     * a database guarantee rather than a service convention.
     */
    publishedAt: timestamp('published_at', { withTimezone: true }),
    /** When the content stops being authoritative — drives the review-due sweep. */
    reviewDueOn: date('review_due_on'),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    docVersionIdx: uniqueIndex('uq_document_version').on(t.documentId, t.version),
    // Ordering key for every listing: `version` alone is unique per document, so pairing it with
    // the document id gives a total order and pagination cannot drop a row.
    docIdx: index('ix_document_version_document').on(t.documentId, t.version),
    statusIdx: index('ix_document_version_status').on(t.status),
    reviewDueIdx: index('ix_document_version_review_due').on(t.reviewDueOn),
  }),
);

export const documentAcknowledgements = documentsSchema.table(
  'document_acknowledgements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * The VERSION acknowledged, not the document. Acknowledging v1 says nothing about v2, so a
     * material change requires fresh consent — keying this on the document would carry an old
     * acknowledgement forward and quietly overstate compliance.
     */
    versionId: uuid('version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id').notNull(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Idempotent by construction: clicking twice is one acknowledgement, not two rows to
    // reconcile later.
    uniq: uniqueIndex('uq_document_ack').on(t.versionId, t.employeeId),
    employeeIdx: index('ix_document_ack_employee').on(t.employeeId),
  }),
);
