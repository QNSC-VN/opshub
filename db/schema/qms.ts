/**
 * qms schema — non-conformances and the corrective actions that close them (ISO 9001 §10.2).
 *
 * WHY THESE TWO TABLES ARRIVE TOGETHER
 * ------------------------------------
 * §10.2 is one obligation in five parts: react to the nonconformity, evaluate whether corrective
 * action is needed, implement it, REVIEW WHETHER IT WORKED, and record both the nonconformity and
 * the actions taken. A register without CAPAs records that something went wrong and nothing was
 * done; CAPAs without a register are floating actions nobody can trace to a cause. The rule that
 * makes the pair worth having — a major finding cannot be closed until a CAPA has been verified
 * effective — needs both tables to exist, so shipping either alone would ship the half that does
 * not enforce anything.
 *
 * WHAT THIS IS NOT
 * ----------------
 * `isms.incidents` is a SECURITY event: something happened, and the states are what has been
 * achieved under time pressure (contained, resolved). A non-conformance is a failure to meet a
 * REQUIREMENT — a clause, a procedure, a customer specification — which may have caused no event at
 * all. The two overlap often enough that `nonconformances.incident_id` exists, so an incident that
 * also breaches a quality requirement is one finding with a pointer rather than a retyped copy.
 *
 * `compliance.compliance_findings` is scan-detected and always about software on a device
 * (`software_name` is NOT NULL there). It feeds this register; it is not this register — the same
 * conclusion the risk register reached about the same table.
 *
 * THREE TABLES, THREE DIFFERENT QUESTIONS
 * ---------------------------------------
 * `nonconformance_severities` is REFERENCE DATA: what each grade means, how the grades RANK, whether
 * a CAPA is mandatory at that grade, and how long containment may take. The third table of this
 * shape after `isms.classification_levels` and `isms.vendor_criticality_levels`, and for the same
 * two reasons — the rank must be a column rather than an enum's declaration order, and the policy
 * each grade carries must be stated once instead of copied into the service.
 *
 * `nonconformances` is the REGISTER: what was found, against which requirement, by whom, and where
 * it stands.
 *
 * `capas` is WHAT WAS DONE ABOUT IT, and whether that worked.
 *
 * INVARIANTS THE DATABASE HOLDS
 * -----------------------------
 * 1. EVERY FINDING HAS AN OWNER — `owner_id` NOT NULL, the same reasoning as
 *    `information_assets.owner_id` and `vendors.owner_id`.
 *
 * 2. A STATE IS PAIRED WITH ITS EVIDENCE — `ck_nc_contained_pair`, `ck_nc_closed_pair`. A
 *    `contained` row with no containment action describes nothing, and a `closed` row with no note
 *    cannot be explained to an auditor. Written with `coalesce(x, '')`, because a CHECK that
 *    evaluates to NULL is SATISFIED — see the checklist entry in the roadmap.
 *
 * 3. `void` CARRIES NOTHING — `ck_nc_void_clean`. "Raised in error" and "contained on Tuesday" are
 *    not both true.
 *
 * 4. TIME RUNS FORWARD — `ck_nc_timeline_order`.
 *
 * 5. A CAPA BELONGS TO A FINDING — `nonconformance_id` NOT NULL. A corrective action with nothing
 *    to correct is the floating-action problem: it cannot be reported on, and nobody can tell later
 *    whether it worked. If something else warrants action — a risk, an incident, an idea — the
 *    finding is raised first. That is one extra record and it is the one that makes the action
 *    traceable.
 *
 * 6. EACH CAPA STATE CARRIES ITS OWN EVIDENCE — a root cause before it may be planned, an
 *    implementation date before it may be verified, and for `verified` both a verifier and the
 *    evidence they relied on. `ck_capa_*`.
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
  pgSchema,
} from 'drizzle-orm/pg-core';
import {
  auditRoleEnum,
  capaRootCauseMethodEnum,
  capaStatusEnum,
  internalAuditStatusEnum,
  nonconformanceSeverityEnum,
  nonconformanceSourceEnum,
  nonconformanceStatusEnum,
} from './enums';
import { incidents } from './isms-incidents';

export const qmsSchema = pgSchema('qms');

/**
 * What each severity grade means, how it ranks, and the policy it carries.
 *
 * Keyed BY THE ENUM, exactly as the classification and criticality tables are. `requires_capa` is
 * the reason this is a table rather than a comment: whether a finding can be closed on its
 * containment alone is a policy decision, and it is read by the closure gate rather than restated
 * in it.
 */
export const nonconformanceSeverities = qmsSchema.table('nonconformance_severities', {
  code: nonconformanceSeverityEnum('code').primaryKey(),
  /** Higher is worse. THE authoritative ordering — see the enum's own comment. */
  rank: smallint('rank').notNull(),
  label: varchar('label', { length: 60 }).notNull(),
  description: text('description').notNull(),
  /**
   * Whether closing a finding at this grade requires a CAPA verified effective.
   *
   * Read by the closure gate in `NonconformanceService`. An observation does not; a major finding
   * does, and that is the difference between a register and a to-do list.
   */
  requiresCapa: boolean('requires_capa').notNull(),
  /** How many days containment may take before the finding shows on the overdue report. */
  containmentDueDays: integer('containment_due_days').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const nonconformances = qmsSchema.table(
  'nonconformances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Quoted in audit reports and CAPA records, e.g. `NC-2026-014`. */
    reference: varchar('reference', { length: 40 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description').notNull(),
    /**
     * The requirement that was not met — a clause, a procedure, a customer specification.
     *
     * NOT NULL, and the field that distinguishes a non-conformance from a complaint: "the process
     * says two approvals and one was recorded" is a finding, "the customer is unhappy" is an input
     * to one.
     */
    requirement: text('requirement').notNull(),
    source: nonconformanceSourceEnum('source').notNull(),

    severity: nonconformanceSeverityEnum('severity')
      .notNull()
      .references(() => nonconformanceSeverities.code, { onDelete: 'restrict' }),
    status: nonconformanceStatusEnum('status').notNull().default('open'),

    /** Where it happened. Free text: every organisation slices its processes differently. */
    processArea: varchar('process_area', { length: 120 }).notNull(),

    /** Accountable for resolving it. NOT NULL — an unowned finding is a complaint. */
    ownerId: uuid('owner_id').notNull(),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    /** Who raised it. Anybody may, which is why reporting carries no permission. */
    raisedBy: uuid('raised_by').notNull(),

    /**
     * The security incident this finding also describes, when there is one.
     *
     * `SET NULL`, not `CASCADE`: closing an incident must not delete the quality finding that
     * referenced it, because the finding and its CAPA are the audit evidence.
     */
    incidentId: uuid('incident_id').references(() => incidents.id, { onDelete: 'set null' }),
    /** Supporting evidence as a controlled document. No FK — cross-schema, checked by the service. */
    evidenceDocumentId: uuid('evidence_document_id'),

    /**
     * The internal audit that raised this finding, when one did.
     *
     * Nullable, and NOT required even when `source = 'internal_audit'`: a finding recorded during
     * fieldwork before the engagement row exists is the normal order of events for a small team, and
     * a blanket requirement would push that record-keeping out of the system. The gap is a REPORT
     * instead — `GET /internal-audits/reports/unlinked-findings` — on the same reasoning as the
     * risk register's unlinked incidents and the vendor register's unassessed spend.
     *
     * `SET NULL`: an audit is never deleted, but if one ever were, the finding and its CAPA are the
     * evidence and must outlive it.
     */
    internalAuditId: uuid('internal_audit_id'),

    /** The immediate fix. Paired with `contained_at` by `ck_nc_contained_pair`. */
    containmentAction: text('containment_action'),
    containedAt: timestamp('contained_at', { withTimezone: true }),

    closedAt: timestamp('closed_at', { withTimezone: true }),
    closureNote: text('closure_note'),
    /** Who accepted the closure. Not necessarily the owner — see the service. */
    closedBy: uuid('closed_by'),

    /** Why it was voided, when it was. Required to void; see the service. */
    voidReason: text('void_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    referenceIdx: uniqueIndex('uq_nc_reference').on(t.reference),
    /** The register's default view: worst first, oldest first. */
    statusIdx: index('ix_nc_status_severity').on(t.status, t.severity),
    ownerIdx: index('ix_nc_owner').on(t.ownerId),
    /** "What keeps going wrong here?" — the recurrence report's query. */
    areaIdx: index('ix_nc_process_area').on(t.processArea),
    detectedIdx: index('ix_nc_detected').on(t.detectedAt),
    incidentIdx: index('ix_nc_incident').on(t.incidentId),
    /** The audit's own finding list, and the unlinked-findings report's anti-join. */
    auditIdx: index('ix_nc_internal_audit').on(t.internalAuditId),
  }),
);

export const capas = qmsSchema.table(
  'capas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Quoted in the finding it closes and in management review, e.g. `CAPA-2026-007`. */
    reference: varchar('reference', { length: 40 }).notNull(),
    /** NOT NULL — see invariant 5. A corrective action with nothing to correct cannot be reviewed. */
    nonconformanceId: uuid('nonconformance_id')
      .notNull()
      .references(() => nonconformances.id, { onDelete: 'cascade' }),

    status: capaStatusEnum('status').notNull().default('analysis'),
    /** Accountable for delivering it. NOT NULL. */
    ownerId: uuid('owner_id').notNull(),

    /**
     * Why it happened, and how that was established.
     *
     * Both required before the CAPA may leave `analysis`: a plan built on no stated cause is a
     * guess, and recording the method is what makes the cause reviewable rather than asserted.
     */
    rootCause: text('root_cause'),
    rootCauseMethod: capaRootCauseMethodEnum('root_cause_method'),

    /** What will be done. Required to plan. */
    actionPlan: text('action_plan'),
    dueOn: date('due_on'),

    implementedAt: timestamp('implemented_at', { withTimezone: true }),

    /**
     * The effectiveness review — ISO 9001 §10.2(d).
     *
     * `verifiedBy` is separate from `ownerId` and the service refuses to let them be the same
     * person: the point of the review is that somebody other than the author agrees it worked.
     */
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: uuid('verified_by'),
    effectivenessEvidence: text('effectiveness_evidence'),

    /** Why the review failed, or why the CAPA was cancelled. */
    outcomeNote: text('outcome_note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    referenceIdx: uniqueIndex('uq_capa_reference').on(t.reference),
    /** "What is outstanding against this finding?" — the closure gate's query. */
    ncIdx: index('ix_capa_nonconformance').on(t.nonconformanceId, t.status),
    ownerIdx: index('ix_capa_owner').on(t.ownerId),
    /** The overdue report's query. */
    dueIdx: index('ix_capa_due').on(t.status, t.dueOn),
  }),
);

/**
 * An internal audit engagement — ISO 9001 §9.2.
 *
 * WHY THE FINDINGS ARE NOT A TABLE HERE
 * -------------------------------------
 * An audit finding IS a non-conformance. `nonconformances.source` already carries `internal_audit`,
 * and §9.2.2(e) requires appropriate action without undue delay — which is the CAPA machinery the
 * register already owns. A separate `audit_findings` table would duplicate the grade, the containment,
 * the closure gate and the CAPA link, and the two copies would immediately disagree about what
 * "closed" means. So the audit gains a pointer FROM the register (`nonconformances.internal_audit_id`)
 * and nothing else.
 *
 * WHAT §9.2 ASKS FOR, AND WHERE EACH PART LIVES
 * ---------------------------------------------
 *   (b) define the audit CRITERIA and SCOPE for each audit — both NOT NULL with substance CHECKs,
 *       because an audit with no stated criteria cannot be repeated or defended.
 *   (c) select auditors to ensure OBJECTIVITY and IMPARTIALITY — `internal_audit_auditors`, plus the
 *       rule enforced in `CapaService`: somebody who audited may not sign off the effectiveness of a
 *       corrective action arising from their own finding. See that service for why it lives there.
 *   (d) REPORT the results to relevant management — the `reported` state, with a conclusion and the
 *       report document required to reach it.
 *   (f) RETAIN documented evidence — the row is never deleted; `cancelled` records an audit that did
 *       not happen and says why.
 */
export const internalAudits = qmsSchema.table(
  'internal_audits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Quoted in the audit programme and in every finding it raises, e.g. `IA-2026-03`. */
    reference: varchar('reference', { length: 40 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    /** What the audit set out to establish. */
    objective: text('objective').notNull(),
    /** Which processes, sites and periods it covers — §9.2.2(b). */
    scope: text('scope').notNull(),
    /**
     * The requirements audited AGAINST — clauses, procedures, customer specifications.
     *
     * Separate from `scope` because they answer different questions: scope is where you looked,
     * criteria is what you judged against. An audit missing either cannot be repeated.
     */
    criteria: text('criteria').notNull(),

    status: internalAuditStatusEnum('status').notNull().default('planned'),

    /**
     * The lead auditor. NOT NULL, and also present in `internal_audit_auditors` as `lead` — the
     * column is what the register is read by, the roster row is what the impartiality rule reads.
     * `AuditService` writes both in one transaction, so they cannot disagree.
     */
    leadAuditorId: uuid('lead_auditor_id').notNull(),

    plannedStartOn: date('planned_start_on'),
    plannedEndOn: date('planned_end_on'),
    startedAt: timestamp('started_at', { withTimezone: true }),

    /** When management were told, and what they were told. Both required to reach `reported`. */
    reportedAt: timestamp('reported_at', { withTimezone: true }),
    conclusion: text('conclusion'),
    /** The audit report as a controlled document. No FK — cross-schema, checked by the service. */
    reportDocumentId: uuid('report_document_id'),

    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** Why it was cancelled. Required to cancel — an audit that did not happen still needs a record. */
    cancelReason: text('cancel_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    referenceIdx: uniqueIndex('uq_internal_audit_reference').on(t.reference),
    statusIdx: index('ix_internal_audit_status').on(t.status),
    leadIdx: index('ix_internal_audit_lead').on(t.leadAuditorId),
    /** The programme view: what is planned when. */
    plannedIdx: index('ix_internal_audit_planned').on(t.plannedStartOn),
  }),
);

/**
 * Who audited, and in what capacity — §9.2.2(c).
 *
 * A table rather than a column because an audit is a team activity and because the IMPARTIALITY rule
 * needs the full set: it asks "did this person audit here", which a single `lead_auditor_id` cannot
 * answer for the auditor who did the fieldwork.
 */
export const internalAuditAuditors = qmsSchema.table(
  'internal_audit_auditors',
  {
    internalAuditId: uuid('internal_audit_id')
      .notNull()
      .references(() => internalAudits.id, { onDelete: 'cascade' }),
    auditorId: uuid('auditor_id').notNull(),
    role: auditRoleEnum('role').notNull().default('auditor'),
    addedBy: uuid('added_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** Natural key: one person holds one role on one audit. */
    pk: primaryKey({ columns: [t.internalAuditId, t.auditorId] }),
    /** "What has this person audited?" — the direction the impartiality rule reads from. */
    auditorIdx: index('ix_internal_audit_auditor_person').on(t.auditorId),
  }),
);
