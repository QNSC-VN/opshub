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
| **EMS** — employee management             | Solid core. `identity.employees`; status transitions; onboarding/offboarding; assets; licences; access. **Positions** with headcount and assignment history. **Employment contracts**: terms, lifecycle, renewal, expiry sweep, pay gated separately. **Training**: course catalogue, per-position requirements, retraining chain, certificate uploads, competency gap report | Performance reviews                                                                                                |
| **ISMS** — information security           | Substantial. Access control (RBAC + scoped PBAC), audit trail, compliance findings, security posture, asset inventory, controlled policies. **Risk register** with generated scoring and engine-approved acceptance. **Controls + SoA** with risk↔control coverage. **Incidents**: state machine, append-only timeline, 72-hour breach clock, risk feedback loop | Asset classification, vendor risk                                                                                    |
| **QMS** — quality management              | Started. Controlled documents: versions, approval through the request engine, publish-supersedes, acknowledgement tracking. Competency records via EMS training | CAPA, non-conformance, internal audit, management review                                                            |

A caution on searching for these: grepping the schema for `risk`, `policy`, `document` or
`vendor` returns hits that are **not** domain tables — `risk_accepted` is a
finding-status enum value, `vendor` is a column on `licenses`, and
`document_storage_key` is a leave-request attachment. QMS and the ISMS items above are
genuinely absent.

## Three decisions that apply to every system

### 1. One approval spine, not one per system

`RequestEngine` (`libs/platform/src/requests/`) plus the `RequestTypeDef` registry already
provides multi-step approval chains, separation of duties, delegation, SLA deadlines,
expiry, audit entries, notifications and webhook fan-out. Eight types are registered today:
`access_request`, `onboarding`, `offboarding`, `leave_request`, `overtime`,
`catalog_request`, `document_approval`, `risk_acceptance`.

Almost every process in these systems is that same shape — a QMS document approval, a
CAPA, an ISMS risk treatment plan, an EMS contract sign-off. Each is a new
`RequestTypeDef` of roughly a hundred lines, declaring its steps and permissions and
supplying `onApprove`.

**The smell to watch for:** a module growing its own `status` column with hand-written
transitions and its own approver check. That is a second workflow engine, and it will not
have the SoD rule, the delegation union, the SLA cron or the audit entry.

Cashed in twice so far: `document_approval`, and `risk_acceptance` — accepting a residual
risk is the one ISMS decision that creates exposure by choice, so ISO 27001 wants a named
approver who is not the assessor. That is separation of duties, which the engine already
has. The risk module keeps only what the engine cannot know: the score being signed off,
frozen into the payload so re-scoring mid-approval cannot change what was approved.

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

3. ~~**EMS depth**~~ — **done**: positions and headcount, contracts, training records.
   Before QMS and ISMS, because QMS competency/training records and ISMS policy
   acknowledgement both hang off employee and position data. Building those first means
   modelling training twice.

   Positions landed first within this step for the same reason: a contract is a contract
   FOR a position and QMS competency is training required for A POSITION, so both would
   otherwise match on `employees.job_title`, which is free text on the person. That column
   is deliberately left in place — the Entra sync writes it and older screens read it.

   Contracts came second and confirmed the ordering: `employment_contracts.position_id` is a
   real reference, so "what does this role pay" and "who is on a fixed term ending this
   quarter" are both queries rather than string matching.

   Training closed the step and paid the ordering off completely: requirements hang off
   `position_id`, so the competency gap report reads each employee's CURRENT assignment and
   survives a transfer with no backfill. That is also the QMS competency artefact and the ISMS
   awareness-training evidence, so neither system needs its own model of it.

   Training was also the first upload surface that ACCUMULATES, which is why it brought
   `storage.attachments` and the policy descriptors with it — see the upload section below.

4. **ISMS** — ~~risk register~~, ~~controls / Statement of Applicability~~, ~~incidents~~
   (all **done**), then asset classification and vendor risk.
   Reuses compliance findings, the asset inventory, the access-control model and the
   document module, so most of its foundation is already here.

   The register came first because everything else in ISMS references it: a control exists to
   treat a risk, the SoA is the list of controls with the risks that justify them, and an
   incident is a risk that materialised. Built the other way round, each of those would need
   its own notion of "how bad is this".

   Two things worth carrying forward from it. `compliance.compliance_findings` was NOT
   extended into a risk table — `software_name` is NOT NULL there and every row is
   scan-detected, so findings are INPUTS to risks rather than risks. And scoring is a
   GENERATED column (`likelihood * impact`), which is why no API accepts a score: a register
   cannot hold a row that disagrees with its own factors.

   The SoA followed and confirmed the sequencing: a control exists to treat a risk, so
   `isms.risk_controls` turns "we have controls" into "this risk is treated by these", and the
   untreated-risk report is that join's anti-join. Three structural decisions worth carrying:

   - The CATALOGUE and the DECISION are separate tables. Merging them would let a re-seed of
     Annex A overwrite the organisation's justifications, and it would make "which controls
     have we not decided about yet?" unanswerable — an ABSENT `soa_entries` row is exactly
     that state, and no column value can distinguish it from "decided, no comment". That
     absence is what `undecided` in the coverage report counts.
   - The SoA is written with PUT, never PATCH. Applicability, justification and status are one
     statement; letting them change independently is how an entry ends up excluded while its
     rationale still argues for inclusion.
   - `ck_soa_applicability` pairs `applicable = false` with `not_applicable`, so "excluded but
     implemented" is unrepresentable rather than merely discouraged.

   Incidents closed the loop the register opened: `incidents.risk_id` is the risk that
   materialised, and "open incidents with no linked risk" is the gap in the assessment nobody
   had foreseen. Three decisions there are worth carrying:

   - **This is the one module that does NOT use the request engine, deliberately.** The engine
     models an APPROVAL — somebody decides yes or no, with separation of duties and an SLA on
     the decision. Incident handling is work under time pressure whose states are what has been
     ACHIEVED (contained, resolved), not what has been permitted; routing it through the engine
     would need an approver for "we have contained it". The state machine is a declared map
     (`ALLOWED_TRANSITIONS`) plus a guarded `WHERE status = <from>`, not an `if` chain.
   - **The timeline is append-only, and written BY the transition.** Every status change appends
     its entry in the same transaction, so a timeline can never be missing the step the status
     column claims happened — and there is no edit or delete route, because a timeline somebody
     can revise afterwards is not evidence.
   - **The 72-hour GDPR clock is derived in ONE query, not stored.** It was first written as a
     generated column and Postgres refused it: `timestamptz + interval` is only STABLE, and a
     generated column must be IMMUTABLE. See the checklist entry below.

5. **QMS** — CAPA, non-conformance, internal audit, management review.
   Last of the four not because it matters least, but because it is the heaviest consumer
   of everything above: documents, training records, the request engine and the audit
   trail. Built last, it is mostly composition.

**Not on this list, and blocking all of it for real users:** `infra/` has never been
applied — there is no deployed OpsHub environment. Every module above is verifiable
locally and in CI, and none of it is usable by an employee until that happens. Decide
whether it lands before or alongside module 1.

## Uploads: one policy descriptor per surface

Ported from rally, which arrived at this shape after every new upload surface had produced
another copy of presign/confirm.

- **`RESOURCE_RULES` in `libs/platform/src/storage/storage.types.ts`** is the whole policy: MIME
  allow-list, size ceiling, `maxPerOwner`, and `inlineDisposition`. The key of the entry is also
  the object-key prefix. Adding a surface is an entry here plus, for multi-file surfaces, link
  rows in `storage.attachments`. It is never a change to `StorageService`.
- **Mechanics in the platform, authorization in the owning module.** `EntityAttachmentsService`
  does presign / confirm / list / download / unlink and the quota; it never maps an entity type to
  a permission. The owning controller proves the subject exists and decides who may act, then
  delegates. An `entityType → permission` map inside the shared service is where cross-entity
  authorization bugs hide.
- **SVG is excluded from every policy, permanently.** It is active content, so an "image" that
  renders inline is stored XSS the moment the bytes come from an origin the app trusts — which is
  exactly what `CDN_FILES_BASE_URL` is.
- **`Content-Disposition` is STORED object metadata, not a response override.** This is a
  deliberate deviation from rally, which applies it on its presigned GET. `resolveUrl` here prefers
  the CDN whenever one is configured and a plain CDN read carries no overrides, so the override
  alone would silently not apply on the path production uses. The header must therefore be in
  `signableHeaders` AND sent by the client — a header named in the command but unsigned is dropped
  by the presigner, verified against LocalStack.
- **`requiredHeaders` is returned, not documented.** The client must send exactly that set: fewer
  fails the signature and so does more, and the failure is a 403 with no CORS headers, which a
  browser reports as an opaque network error.
- **The checksum is advisory.** A presigned PUT cannot require one without the client sending a
  matching `x-amz-*` header, which the presigner drops — rally proved that the hard way. It is
  recorded at presign and compared on confirm where the backend reports one, because size alone
  cannot catch a same-length substitution.
- **1:1 surfaces keep their key column.** `employees.photo_storage_key` and friends are not
  migrated onto the link table: the column IS the relationship, and a join per avatar render buys
  only uniformity.

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
- **POST status** — a `@Post` that transitions state rather than creating a row needs
  `@HttpCode(HttpStatus.OK)` alongside its `@ApiOkResponse`. Nest answers 201 otherwise, so the
  OpenAPI document — and the client generated from it — promises a status the server never sends.
  15 routes across six controllers were doing this. Enforced by
  `test/post-status-contract.ratchet.spec.ts`, baseline 0.
- **Uploads** — a `RESOURCE_RULES` entry, and `EntityAttachmentsService` for anything that can
  own more than one file. Never a second copy of presign/confirm. E2E it against the LocalStack
  service in CI rather than a stubbed `StorageService`: a stub agrees with whatever the code does,
  and both real defects here (an unsigned header silently dropped, a presigned GET returning a
  Promise cast to a string) were invisible without real bytes.
- **E2E reset** — add every new table to `FIXTURE_TABLES` in `db/reset.ts`. Nothing in the
  suite tears down what it creates, so an unlisted table keeps its rows forever and the
  failure arrives later, in someone else's spec, looking like a product bug. Positions found
  this as `POSITION_INVALID_WINDOW` on a second run; the leave suite found it as arithmetic
  drifting once 12 years' worth of stale holidays had piled up. Both were "passes exactly
  once per database".
- **`pnpm typecheck` is the gate, not `tsc -b`.** They read different tsconfigs: `tsc -b` follows the
  project references and can report a clean build while `tsc --noEmit -p tsconfig.json` — which is
  what `pnpm typecheck` and CI run — rejects a spec file it never looked at. An invalid cast in a
  `.spec.ts` passed `tsc -b` locally and failed CI's typecheck. Run both before pushing; `tsc -b` is
  the fast loop, `pnpm typecheck` is the answer.
- **Generated columns must be IMMUTABLE.** `timestamptz + interval` is only STABLE — it depends on
  the session time zone and therefore on DST — so Postgres rejects it with
  `ERROR 42P17: generation expression is not immutable`. `likelihood * impact` on integers is fine;
  anything touching a timestamp and an interval is not. Derive it in the one query that needs it and
  index the column it is derived FROM.
- **Read every CHECK you write back to yourself.** Migration 0020's first draft carried
  `CHECK (a IS NOT NULL OR b IS NOT NULL OR TRUE)` — a tautology that can never fail, which would
  have sat in the schema looking like a guarantee while enforcing nothing. Same family as a ratchet
  that cannot fail: if you cannot state the row it rejects, it is not a constraint.
- **Invariants the database cannot hold** — count-based rules (`at most N open rows`) need a
  service check INSIDE the transaction, because a unique index cannot express them and a CHECK
  cannot see other rows. Where a CHECK *does* hold the rule, still refuse the bad input in the
  service: a raw constraint violation reaches the caller as a 500 with no error code.
