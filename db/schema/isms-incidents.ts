/**
 * isms incidents — security incidents, their handling timeline, and the breach-notification clock.
 *
 * AN INCIDENT IS A RISK THAT MATERIALISED, which is why `risk_id` exists: the register said this
 * could happen, and the incident is the evidence that it did. Nullable because plenty of incidents
 * are things nobody had on the register — and noticing that is itself the feedback loop, surfaced by
 * "incidents with no linked risk" rather than by forcing a link nobody believes.
 *
 * WHY NOT THE REQUEST ENGINE. Every other multi-step flow in this codebase is a `RequestTypeDef`,
 * and the roadmap warns specifically against modules growing their own status columns. An incident
 * is the exception, deliberately: the engine models an APPROVAL — somebody decides yes or no, with
 * separation of duties and an SLA on the decision. Incident handling is not a decision awaiting
 * approval; it is work proceeding under time pressure, where the states are what has been ACHIEVED
 * (contained, resolved) rather than what has been permitted. Forcing it through the engine would
 * mean an approver for "we have contained it", which nobody approves.
 *
 * THE TIMELINE IS APPEND-ONLY. `incident_events` has no update or delete path, in the schema or the
 * service. A post-incident review is read by people deciding whether the handling was adequate, and
 * a timeline somebody can quietly edit afterwards is not evidence of anything. Corrections are new
 * entries.
 *
 * TIMESTAMPS ARE MONOTONIC AND PAIRED WITH STATUS — six CHECKs. `contained_at` without `contained`
 * is a lie, and `resolved_at` before `detected_at` is a data-entry error rather than a state.
 *
 * THE 72-HOUR CLOCK IS DERIVED IN THE QUERY, NOT STORED — a correction rather than a preference.
 * It was first written as a generated column and Postgres refused it: `generation expression is not
 * immutable` (42P17), because `timestamptz + interval` depends on the session time zone and so on
 * DST, while a generated column must be IMMUTABLE. So the deadline lives in exactly one place, the
 * repository's overdue query, and the partial index covers `detected_at` — which is the column that
 * query filters and orders on. GDPR Article 33 counts from becoming aware, so detection is the
 * anchor either way.
 */
import { sql } from 'drizzle-orm';
import { uuid, varchar, text, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { incidentEventTypeEnum, incidentSeverityEnum, incidentStatusEnum } from './enums';
// `ismsSchema` is declared once, in `./isms`; a second `pgSchema('isms')` would collide on export.
import { ismsSchema, risks } from './isms';
import { assets } from './assets';

export const incidents = ismsSchema.table(
  'incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Quoted in the post-incident report and any regulator correspondence, e.g. `INC-2026-004`. */
    reference: varchar('reference', { length: 40 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description').notNull(),
    /** Free text: `phishing`, `malware`, `data_loss`, `availability`. Companies group differently. */
    category: varchar('category', { length: 64 }).notNull(),
    severity: incidentSeverityEnum('severity').notNull(),
    status: incidentStatusEnum('status').notNull().default('reported'),

    /**
     * When it was DETECTED, not when the row was created.
     *
     * Every deadline in incident handling counts from detection, and the two differ by however long
     * it took somebody to open the form.
     */
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull(),
    reportedBy: uuid('reported_by').notNull(),
    /** The responder. Null until somebody triages it, which is what triage IS. */
    assignedTo: uuid('assigned_to'),

    containedAt: timestamp('contained_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),

    /** Required to resolve: an incident with no known cause is still open, whatever the status says. */
    rootCause: text('root_cause'),
    /** Required to close — ISO 27001 A.5.27 is "learning from information security incidents". */
    lessonsLearned: text('lessons_learned'),

    /** The asset involved. `SET NULL`: retiring a laptop must not delete the incident record. */
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'set null' }),
    /**
     * The risk this incident realised, when the register had it.
     *
     * `SET NULL` rather than `CASCADE` for the same reason as the asset: closing a risk must not
     * erase the incident that proves it was real.
     */
    riskId: uuid('risk_id').references(() => risks.id, { onDelete: 'set null' }),

    /** Whether personal data was involved, which is what starts the regulator clock. */
    personalDataBreach: boolean('personal_data_breach').notNull().default(false),
    regulatorNotifiedAt: timestamp('regulator_notified_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    referenceIdx: uniqueIndex('uq_incident_reference').on(t.reference),
    /** The response queue: what is open, worst first. */
    statusIdx: index('ix_incident_status_severity').on(t.status, t.severity),
    assigneeIdx: index('ix_incident_assignee').on(t.assignedTo),
    riskIdx: index('ix_incident_risk').on(t.riskId),
    assetIdx: index('ix_incident_asset').on(t.assetId),
    /**
     * The breach-deadline report.
     *
     * On `detected_at`, because the deadline is derived from it, and partial because only an
     * unnotified breach can be overdue — so the index stays small however many incidents accumulate.
     */
    breachIdx: index('ix_incident_breach_detected')
      .on(t.detectedAt)
      .where(sql`personal_data_breach = true AND regulator_notified_at IS NULL`),
  }),
);

export const incidentEvents = ismsSchema.table(
  'incident_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    type: incidentEventTypeEnum('type').notNull(),
    /** What happened. For a `status_change` the service writes it; otherwise a responder does. */
    detail: text('detail').notNull(),
    /** Who recorded it. Never null: an anonymous timeline entry is not evidence. */
    recordedBy: uuid('recorded_by').notNull(),
    /**
     * When the described thing HAPPENED, which may be before it was written down.
     *
     * A responder reconstructing a timeline the morning after needs to say "the alert fired at
     * 02:14", and `created_at` cannot carry that.
     */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /**
     * The timeline's own ordering: by when things happened, `id` last.
     *
     * `occurred_at` is emphatically not unique — several entries share a minute during an incident —
     * so without the tiebreaker pagination over a long timeline drops and repeats rows.
     */
    incidentIdx: index('ix_incident_event_incident').on(t.incidentId, t.occurredAt, t.id),
  }),
);
