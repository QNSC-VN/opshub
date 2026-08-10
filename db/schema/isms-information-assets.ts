/**
 * isms information assets — the classification register, its history, and which devices hold what.
 *
 * WHY THIS IS NOT `assets.assets`
 * -------------------------------
 * `assets.assets` is the DEVICE inventory: asset tag, manufacturer, serial number, MDM device id,
 * warranty expiry, a photo of the physical thing, and a status enum that runs `in_stock` →
 * `assigned` → `in_repair` → `retired` → `lost`. Every one of those columns is about a piece of
 * hardware somebody can pick up.
 *
 * An information asset is a payroll system, a customer database, a source repository, a room of
 * signed contracts. Widening the device table to hold those would leave `asset_tag` (NOT NULL and
 * unique) needing a fabricated value for "Customer CRM", `serial_number` and `warranty_expiry`
 * permanently null, `assigned_to` meaningless, and the status enum outright lying — a database is
 * never `in_stock`. That is one table doing two jobs, and the half that is null is the half that
 * tells the next reader nothing.
 *
 * So the register is its own table, and the relationship to hardware is modelled where it actually
 * exists: `information_asset_devices`. That link is what answers the question security asks the
 * moment a laptop goes missing — WHAT WAS ON IT — and it is why the link is a table rather than a
 * column: one laptop holds several information assets and one system lives on many laptops.
 *
 * `isms.risks.asset_id` and `isms.incidents.asset_id` still mean a DEVICE, unchanged by this module.
 * A lost-laptop incident reaches the classification through the device link, so neither table needed
 * a second nullable pointer to keep the chain intact.
 *
 * FOUR TABLES, FOUR DIFFERENT QUESTIONS
 * -------------------------------------
 * `classification_levels` is REFERENCE DATA: what the labels mean, how they rank, and how each must
 * be handled. It exists so that the RANK and the HANDLING RULES are stated once. Rank in particular
 * has to be a column: ordering by the enum's declaration order is the kind of implicit dependency
 * that breaks silently the first time somebody appends a label, and "restricted" being top must not
 * rest on it having been typed last.
 *
 * `information_assets` is the REGISTER — the inventory ISO 27001 A.5.9 asks for, with the owner
 * A.5.9 requires by name and the classification A.5.12 requires.
 *
 * `asset_classification_history` is WHY IT IS CLASSIFIED THE WAY IT IS. Append-only, one row per
 * change including the first, so the current label is always explicable and a reduction in
 * protection can never be quietly applied.
 *
 * `information_asset_devices` is WHICH HARDWARE HOLDS IT.
 *
 * INVARIANTS THE DATABASE HOLDS
 * -----------------------------
 * 1. EVERY ASSET HAS AN OWNER — `owner_id` is NOT NULL. This is the single most-audited fact about
 *    an asset register, and a nullable column would turn it into a report to chase rather than a
 *    thing that cannot happen. The employee's existence is checked by the service, following the
 *    same convention as `soa_entries.owner_id`: cross-schema references here carry no FK.
 *
 * 2. EVERY LABEL HAS RULES — `classification` is an FK to `classification_levels`, so a classified
 *    asset always has a rank to sort by and rules to hand somebody. `ON DELETE RESTRICT` keeps a
 *    level in use from being removed underneath it.
 *
 * 3. THE LABEL AND THE CONFIDENTIALITY RATING CANNOT CONTRADICT EACH OTHER —
 *    `ck_information_asset_classification_confidentiality`. Public with a high confidentiality
 *    rating is a contradiction in terms, and `restricted` with a rating of 1 or 2 means somebody
 *    labelled it without assessing it. Only the two extremes are constrained: the middle of the
 *    scale is a judgement call, and a CHECK that forced an exact mapping would just make the rating
 *    a restatement of the label.
 *
 * 4. PERSONAL DATA IS NEVER PUBLIC OR MERELY INTERNAL —
 *    `ck_information_asset_personal_data_classification`. This is the column the 72-hour breach
 *    clock in `isms.incidents` keys off, so it has to mean something on its own.
 *
 * 5. A CHANGE MUST CHANGE SOMETHING — `ck_asset_classification_history_change`. A history row from
 *    `confidential` to `confidential` is noise in the one place that must stay readable.
 */
import {
  uuid,
  varchar,
  text,
  date,
  boolean,
  integer,
  smallint,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { informationAssetTypeEnum, informationClassificationEnum } from './enums';
import { assets } from './assets';
// `ismsSchema` is declared ONCE, in `./isms`, and imported here: two `pgSchema('isms')` values would
// both be exported through `db/schema/index.ts` and collide on the name.
import { ismsSchema } from './isms';

/**
 * What each label means, how it ranks, and how information carrying it must be handled.
 *
 * Keyed BY THE ENUM, so a level row and a label are the same thing rather than two lists to keep in
 * step. The remaining gap — an enum value with no row — cannot be expressed as a constraint, so it
 * is covered by a test that reads the levels back and compares them with the enum.
 */
export const classificationLevels = ismsSchema.table('classification_levels', {
  code: informationClassificationEnum('code').primaryKey(),
  /** Higher is more protected. THE authoritative ordering — see the enum's own comment. */
  rank: smallint('rank').notNull(),
  label: varchar('label', { length: 60 }).notNull(),
  /** What handling this level demands: storage, transmission, disposal, who may see it. */
  handlingRules: text('handling_rules').notNull(),
  /** Whether encryption at rest is mandatory at this level. Read by the posture report. */
  encryptionRequired: boolean('encryption_required').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const informationAssets = ismsSchema.table(
  'information_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Quoted in the register, in risk assessments and in audit findings, e.g. `IA-014`. */
    reference: varchar('reference', { length: 40 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    type: informationAssetTypeEnum('type').notNull(),

    classification: informationClassificationEnum('classification')
      .notNull()
      .references(() => classificationLevels.code, { onDelete: 'restrict' }),

    /** Accountable for the asset. NOT NULL — an unowned asset is a note, not a register entry. */
    ownerId: uuid('owner_id').notNull(),
    /**
     * Who runs it day to day, when that is not the owner.
     *
     * Optional because plenty of assets have no separate custodian, and inventing one would make the
     * column a formality. Where it exists it is the person an incident responder actually calls.
     */
    custodianId: uuid('custodian_id'),

    /**
     * The CIA rating, 1..5 each — the same scale as the risk register's likelihood and impact, so a
     * risk about this asset and the asset itself are read on one scale rather than two.
     */
    confidentiality: smallint('confidentiality').notNull(),
    integrity: smallint('integrity').notNull(),
    availability: smallint('availability').notNull(),

    /**
     * Whether it holds personal data.
     *
     * The breach clock in `isms.incidents` is the consumer: an incident touching an asset with this
     * set is the one that has 72 hours on it.
     */
    personalData: boolean('personal_data').notNull().default(false),

    /** Where it lives — a region, a data centre, a SaaS tenant, a filing room. */
    location: varchar('location', { length: 200 }),
    /** How long the information is kept, in months. Null means no retention rule recorded yet. */
    retentionMonths: integer('retention_months'),

    lastReviewedAt: timestamp('last_reviewed_at', { withTimezone: true }),
    /** When this entry must be revisited. "Overdue" is this against today, never a stored flag. */
    reviewDueOn: date('review_due_on'),

    /**
     * Retired assets stay in the register, for the same reason retired controls do: a risk
     * assessment and an incident from last year reference this row, and deleting it orphans them.
     */
    retiredAt: timestamp('retired_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    referenceIdx: uniqueIndex('uq_information_asset_reference').on(t.reference),
    classificationIdx: index('ix_information_asset_classification').on(t.classification),
    ownerIdx: index('ix_information_asset_owner').on(t.ownerId),
    typeIdx: index('ix_information_asset_type').on(t.type),
    /** The review-due report's query, matching `ix_soa_review_due`. */
    reviewIdx: index('ix_information_asset_review_due').on(t.reviewDueOn),
  }),
);

/**
 * Every classification this asset has ever carried, and why.
 *
 * There is deliberately no update and no delete. The register's label is read by people deciding how
 * to handle information; a history that can be edited afterwards cannot show that protection was
 * once higher, which is exactly the change worth being able to see.
 *
 * The FIRST row has a null `from_level`: the asset was classified at creation, out of nothing. That
 * is what makes the chain complete — the current label always traces back to an initial decision
 * rather than appearing from an unexplained default.
 */
export const assetClassificationHistory = ismsSchema.table(
  'asset_classification_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    informationAssetId: uuid('information_asset_id')
      .notNull()
      .references(() => informationAssets.id, { onDelete: 'cascade' }),
    /** Null only for the initial classification recorded when the asset was registered. */
    fromLevel: informationClassificationEnum('from_level'),
    toLevel: informationClassificationEnum('to_level').notNull(),
    /** Why it moved. Required, and required to have substance — see the length CHECK. */
    reason: text('reason').notNull(),
    changedBy: uuid('changed_by').notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /**
     * The history read, `id` last: several changes can share a timestamp when a script reclassifies
     * in bulk, so without the tiebreaker pagination over a long history drops and repeats rows.
     */
    assetIdx: index('ix_asset_classification_history_asset').on(
      t.informationAssetId,
      t.changedAt,
      t.id,
    ),
  }),
);

/**
 * Which devices hold which information asset.
 *
 * The point of the join: a lost or stolen laptop becomes a classification question immediately —
 * "this device held two `restricted` assets, one of them personal data" — instead of an inventory
 * lookup followed by guesswork.
 */
export const informationAssetDevices = ismsSchema.table(
  'information_asset_devices',
  {
    informationAssetId: uuid('information_asset_id')
      .notNull()
      .references(() => informationAssets.id, { onDelete: 'cascade' }),
    /**
     * `RESTRICT`, not `CASCADE` or `SET NULL`.
     *
     * A hard delete of a device that still holds registered information fails, because losing the
     * link would lose the answer to "what was on it". This is a backstop rather than a workflow: the
     * API never deletes a device, it RETIRES one (`POST /assets/:id/retire`), and retirement leaves
     * the link intact — deliberately, since a disposed laptop's holdings are exactly what a later
     * question is about. `CASCADE` would delete that history and `SET NULL` cannot, the column being
     * half of the primary key.
     */
    deviceAssetId: uuid('device_asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'restrict' }),
    linkedBy: uuid('linked_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** Natural key: the same device linked twice to one asset is still one link. */
    pk: primaryKey({ columns: [t.informationAssetId, t.deviceAssetId] }),
    /** "What is on this device?" — the direction a lost laptop is read from. */
    deviceIdx: index('ix_information_asset_device_device').on(t.deviceAssetId),
  }),
);
