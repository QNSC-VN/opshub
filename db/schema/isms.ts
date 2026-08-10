/**
 * isms schema — the risk register and the treatment plans hanging off it.
 *
 * WHY THIS IS NOT `compliance.compliance_findings`
 * -----------------------------------------------
 * That table is shadow-IT specific: `software_name` is NOT NULL and every row is something a scan
 * detected on a device. A risk is the opposite kind of object — deliberately identified by a person,
 * scored, owned, treated or accepted, and reviewed on a cadence. Findings are INPUTS to risks.
 *
 * SCORING IS A GENERATED COLUMN, not a value the application writes. `inherent_score` and
 * `residual_score` are `likelihood × impact` computed by Postgres, so a register cannot contain a
 * row whose score disagrees with its own factors. Two things follow that a service-side calculation
 * would not give: the seed and any fix-up script get it right for free, and `ORDER BY score DESC`
 * is an index-able column rather than an expression the planner has to recompute.
 *
 * RESIDUAL CANNOT EXCEED INHERENT — `ck_risk_residual_not_worse`. Treatment reduces risk or leaves
 * it alone; a residual score above the inherent one means somebody has mixed up the two columns,
 * which is a data-entry error rather than a state worth representing.
 *
 * ACCEPTANCE IS AN APPROVAL, so `accepted_via_request_id` points at the request that authorised it.
 * ISO 27001 asks who accepted a residual risk and on what basis; a boolean would answer neither.
 * The engine owns the approval chain, and this column is the evidence link.
 */
import { sql } from 'drizzle-orm';
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
import { riskStatusEnum, riskTreatmentDecisionEnum, riskTreatmentStatusEnum } from './enums';
import { assets } from './assets';

export const ismsSchema = pgSchema('isms');

export const risks = ismsSchema.table(
  'risks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Quoted in the treatment plan, the SoA and audit findings, e.g. `RSK-2026-014`. */
    reference: varchar('reference', { length: 40 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description').notNull(),
    /** Free text: `access_control`, `supplier`, `physical`, `availability`. Companies group differently. */
    category: varchar('category', { length: 64 }).notNull(),
    /**
     * The asset in scope, when the risk is about one.
     *
     * `SET NULL` rather than `CASCADE`: retiring a laptop must not delete the risk record that
     * mentioned it, because the assessment and its acceptance are the audit evidence.
     */
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'set null' }),
    /** The accountable employee. Not nullable — an unowned risk is a note, not a register entry. */
    ownerId: uuid('owner_id').notNull(),

    inherentLikelihood: integer('inherent_likelihood').notNull(),
    inherentImpact: integer('inherent_impact').notNull(),
    /** `likelihood × impact`, computed by Postgres so it cannot disagree with its factors. */
    inherentScore: integer('inherent_score').generatedAlwaysAs(
      sql`inherent_likelihood * inherent_impact`,
    ),

    treatmentDecision: riskTreatmentDecisionEnum('treatment_decision'),
    /** Both residual factors or neither — a half-scored residual is not a score. */
    residualLikelihood: integer('residual_likelihood'),
    residualImpact: integer('residual_impact'),
    residualScore: integer('residual_score').generatedAlwaysAs(
      sql`residual_likelihood * residual_impact`,
    ),

    status: riskStatusEnum('status').notNull().default('identified'),
    /** When this assessment must be revisited. "Overdue" is this against today, not a stored flag. */
    reviewDueOn: date('review_due_on'),

    /** Who accepted the residual risk, on what basis, and under which approval. */
    acceptedBy: uuid('accepted_by'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptanceJustification: text('acceptance_justification'),
    acceptedViaRequestId: uuid('accepted_via_request_id'),

    closedAt: timestamp('closed_at', { withTimezone: true }),
    closureNote: varchar('closure_note', { length: 300 }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    referenceIdx: uniqueIndex('uq_risk_reference').on(t.reference),
    /** The register's default view: worst first. */
    scoreIdx: index('ix_risk_status_score').on(t.status, t.inherentScore),
    ownerIdx: index('ix_risk_owner').on(t.ownerId),
    assetIdx: index('ix_risk_asset').on(t.assetId),
    /** The review-due report's query. */
    reviewIdx: index('ix_risk_review_due').on(t.status, t.reviewDueOn),
  }),
);

export const riskTreatments = ismsSchema.table(
  'risk_treatments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    riskId: uuid('risk_id')
      .notNull()
      .references(() => risks.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    /** Who is doing it. Separate from the risk owner: the owner is accountable, this is assigned. */
    ownerId: uuid('owner_id').notNull(),
    dueOn: date('due_on'),
    status: riskTreatmentStatusEnum('status').notNull().default('planned'),
    completedOn: date('completed_on'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    riskIdx: index('ix_risk_treatment_risk').on(t.riskId, t.status),
    ownerIdx: index('ix_risk_treatment_owner').on(t.ownerId),
    dueIdx: index('ix_risk_treatment_due').on(t.status, t.dueOn),
  }),
);
