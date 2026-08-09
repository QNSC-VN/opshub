# OpsHub system roadmap — EMS, TMS, ISMS, QMS

OpsHub is one internal platform covering several management systems. This records what
exists today, the shared primitives that must be built once, and the order the remaining
systems should be built in — with the reasoning, because the order is driven by
dependencies rather than by which system is most interesting.

Written after an audit of `db/schema/**` and `libs/modules/**`, not from memory. Where it
says something is absent, that was checked.

## Where each system stands

| System                                    | State                                                                                                                       | Missing                                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **TMS** — time management                 | ~90%. Timesheets, leave, overtime and shift logs, each with a real approval workflow. Leave entitlement, balances, holiday calendar and working-day counting | Accrual over time, carry-over between years, part-day leave                                                        |
| **EMS** — employee management             | Solid core. `identity.employees` with `department`, `jobTitle`, `managerId`; status transitions; onboarding/offboarding workflows; assets; licences; access. **Positions**, approved headcount and assignment history | Contracts, training records, performance reviews                                                                   |
| **ISMS** — information security           | Partial. Access control (RBAC + scoped PBAC), audit trail, software/device compliance findings, security posture, asset inventory, controlled policies with acknowledgement | **Risk register**, asset classification, controls / Statement of Applicability, incidents, vendor risk              |
| **QMS** — quality management              | Started. Controlled documents: versions, approval through the request engine, publish-supersedes, acknowledgement tracking     | CAPA, non-conformance, internal audit, management review, training records                                          |

A caution on searching for these: grepping the schema for `risk`, `policy`, `document` or
`vendor` returns hits that are **not** domain tables — `risk_accepted` is a
finding-status enum value, `vendor` is a column on `licenses`, and
`document_storage_key` is a leave-request attachment. QMS and the ISMS items above are
genuinely absent.

## Three decisions that apply to every system

### 1. One approval spine, not one per system

`RequestEngine` (`libs/platform/src/requests/`) plus the `RequestTypeDef` registry already
provides multi-step approval chains, separation of duties, delegation, SLA deadlines,
expiry, audit entries, notifications and webhook fan-out. Six types are registered today:
`access_request`, `onboarding`, `offboarding`, `leave_request`, `overtime`,
`catalog_request`.

Almost every process in these systems is that same shape — a QMS document approval, a
CAPA, an ISMS risk treatment plan, an EMS contract sign-off. Each is a new
`RequestTypeDef` of roughly a hundred lines, declaring its steps and permissions and
supplying `onApprove`.

**The smell to watch for:** a module growing its own `status` column with hand-written
transitions and its own approver check. That is a second workflow engine, and it will not
have the SoD rule, the delegation union, the SLA cron or the audit entry.

### 2. Build "controlled document" ONCE

ISMS policies, QMS SOPs and work instructions, and EMS contracts and handbooks are all
the same primitive: a document with **versions**, an **approval** before publication, an
**acknowledgement** per employee, a **review-due date**, and **supersession** rather than
deletion.

Build it as one module that three systems consume. Getting this wrong means three schemas,
three approval flows and three acknowledgement tables — and then a question like "which
employees have not acknowledged the current version of anything?" cannot be answered with
one query.

It is deliberately sequenced before the systems that need it, because the second consumer
is what turns a shortcut into a rewrite.

### 3. The evidence trail already exists — do not rebuild it

ISO 9001 and ISO 27001 both require knowing who changed what and when. `audit.audit_logs`
plus the typed `AUDIT_ACTION` catalogue is that record, and audit entries now commit inside
the transaction that made the change, so an entry cannot describe something that did not
happen.

A new module records history by calling `AuditService.record(input, tx)` with a catalogue
action. It does not add a `*_history` table.

## Build order, and why this order

1. ~~**Finish TMS**~~ — **done**: leave entitlement, balances, holiday calendar,
   working-day calculation.
   Smallest piece of work, and it completed a system that was otherwise done.
   `leave_requests` used to store start and end dates with **no day count at all**, so
   leave was approved without anyone knowing what it cost or whether the employee had the
   days. A correctness gap in a shipped feature, which outranked new systems.

2. ~~**Controlled-document module**~~ — **done**: the shared primitive from decision 2,
   ahead of the ISMS policies and QMS SOPs that both need it.

3. **EMS depth** — ~~positions and headcount~~ (**done**), then contracts and training
   records.
   Before QMS and ISMS, because QMS competency/training records and ISMS policy
   acknowledgement both hang off employee and position data. Building those first means
   modelling training twice.

   Positions landed first within this step for the same reason: a contract is a contract
   FOR a position and QMS competency is training required for A POSITION, so both would
   otherwise match on `employees.job_title`, which is free text on the person. That column
   is deliberately left in place — the Entra sync writes it and older screens read it.

4. **ISMS** — risk register, controls / Statement of Applicability, incidents, asset
   classification, vendor risk.
   Reuses compliance findings, the asset inventory, the access-control model and the
   document module, so most of its foundation is already here.

5. **QMS** — CAPA, non-conformance, internal audit, management review.
   Last of the four not because it matters least, but because it is the heaviest consumer
   of everything above: documents, training records, the request engine and the audit
   trail. Built last, it is mostly composition.

**Not on this list, and blocking all of it for real users:** `infra/` has never been
applied — there is no deployed OpsHub environment. Every module above is verifiable
locally and in CI, and none of it is usable by an employee until that happens. Decide
whether it lands before or alongside module 1.

## Checklist for a new module

The platform enforces most of this automatically; the ratchets will fail a PR that skips a
step, which is the point.

- **Structure** — `libs/modules/<name>/src/{domain,application,infrastructure,interface}`,
  with a repository port in `domain/ports` and a Drizzle implementation in
  `infrastructure/persistence`. Fifteen modules already follow this; copy the nearest one.
- **Schema** — a `pgSchema('<name>')` in `db/schema/`, plus a hand-written migration, plus an
  entry in `db/migrations/meta/_journal.json`. An unregistered SQL file is skipped SILENTLY:
  `pnpm db:migrate` prints "Migrations applied" and creates nothing.
- **Grants, if the migration adds a SCHEMA** — repeat the grant block from
  `0015_controlled_documents.sql`. Migration 0012 granted the least-privilege roles access by
  iterating the schemas that existed then, so a later schema is invisible to it and the runtime
  role can see it but read nothing in it. Local development cannot catch this — a developer
  connects as the owner, which is exempt — but CI runs its e2e suite as `opshub_app` on purpose
  and fails with a 500 on the first insert.
- **Authorization** — every route declares one of `@RequirePermission`, `@Public`,
  `@SelfScoped`, `@SharedRead`, `@AuthorizedInService` or `@AuthzGap`. The app **refuses to
  boot** on an undeclared route (`assertEveryRouteDeclaresAuthz`), so this is not optional.
  New permission codes go in `db/permissions.catalog.ts`; opshub's seed rewrites
  `role_permissions` per role, so a re-seed propagates them with no backfill migration.
- **Approvals** — a `RequestTypeDef`, not a bespoke status machine. See decision 1.
- **Audit** — `AuditService.record(input, tx)` inside the mutation's transaction, with new
  actions added to `AUDIT_ACTION`. An inline string is a compile error.
- **Ordering** — every `ORDER BY` ends in a unique column, or pagination silently drops
  rows. Enforced by `test/query-ordering.ratchet.spec.ts`.
- **Path params** — `@Param('id', ParseUUIDPipe)`, or a malformed id becomes a 500.
- **Scheduled work** — through `ExclusiveJob.run()`, or a second replica runs it twice.
- **Tests** — unit specs for the domain rules, an API e2e spec for the flow **and** for
  authorization in both directions, and one Playwright journey through the surface
  (`apps/web/e2e/`). A per-page smoke check is not a journey.
- **E2E reset** — add every new table to `FIXTURE_TABLES` in `db/reset.ts`. Nothing in the
  suite tears down what it creates, so an unlisted table keeps its rows forever and the
  failure arrives later, in someone else's spec, looking like a product bug. Positions found
  this as `POSITION_INVALID_WINDOW` on a second run; the leave suite found it as arithmetic
  drifting once 12 years' worth of stale holidays had piled up. Both were "passes exactly
  once per database".
- **Invariants the database cannot hold** — count-based rules (`at most N open rows`) need a
  service check INSIDE the transaction, because a unique index cannot express them and a CHECK
  cannot see other rows. Where a CHECK *does* hold the rule, still refuse the bad input in the
  service: a raw constraint violation reaches the caller as a 500 with no error code.
