-- ============================================================================
-- Migration 0028: part-day leave
-- ============================================================================
-- A leave window now runs from `start_date` at `start_portion` to `end_date` at
-- `end_portion`. A single afternoon off costs half a day; leave that begins after
-- lunch on Wednesday and ends at lunch on Friday costs two.
--
-- WHY PORTIONS AND NOT HOURS
--
-- The entitlement is denominated in DAYS — `granted_days`, `carried_over_days`,
-- `working_days` are all `numeric(5,2)` — so an hours column would need a
-- hours-per-day figure to convert, and that figure does not exist anywhere in
-- OpsHub: there is no organisation-settings table and no per-employee contract
-- hours. Inventing one would put a second, unowned unit into the middle of the
-- balance arithmetic. Half days are what the business actually books, and they
-- divide the existing unit exactly.
--
-- NO NEW COLUMN FOR THE COST. `working_days` is already `numeric(5,2)`, so `0.5`
-- fits with no schema change and every consumer — the balance sum, the frozen
-- per-request cost, the report — keeps working unchanged. That is the whole
-- reason this migration is as small as it is.
--
-- CANONICAL FORM, ENFORCED
--
-- Every window has exactly ONE spelling, which is what stops two rows that mean
-- the same thing from comparing as different:
--
-- 1. A WHOLE DAY IS `full_day`, not `morning`-to-`afternoon`.
--    `ck_leave_single_day_portions_match` requires the two portions to be equal
--    on a single-day request, so morning-to-afternoon cannot be used to spell a
--    full day, and `full_day`-to-`morning` — which reads as a day that starts
--    whole and ends half — cannot exist at all.
--
-- 2. A MULTI-DAY WINDOW CANNOT START IN THE MORNING ONLY.
--    `ck_leave_multi_day_start_portion`. "Morning" means the morning is all that
--    is taken; a window continuing into the next day contradicts it. Leave that
--    begins at midday begins in the AFTERNOON.
--
-- 3. A MULTI-DAY WINDOW CANNOT END IN THE AFTERNOON ONLY.
--    `ck_leave_multi_day_end_portion`, the mirror image. Leave that ends at
--    midday ends with a MORNING.
--
-- 4. COST IS A WHOLE NUMBER OF HALF DAYS.
--    `ck_leave_working_days_half_day_multiple`. Leave is booked in halves, so a
--    cost of 0.33 is arithmetic that went wrong somewhere, and the row that
--    records it is what a balance is summed from. Cheap to state, and it pins the
--    unit rather than trusting every future caller to respect it.
--
-- THE NULL TRAP DOES NOT APPLY TO 1-3, AND THAT IS DELIBERATE
--
-- A CHECK that evaluates to NULL is SATISFIED, so an implication over a nullable
-- column silently accepts the row it should reject (see migration 0023). Both
-- portion columns are NOT NULL with a default, so there is no NULL to reach the
-- comparison. `working_days` IS nullable — rows predating migration 0014 — so 4
-- spells its null case out.
--
-- WHAT THE SERVICE HOLDS THAT NO CHECK CAN
--
--   * THE COST ITSELF. Half a day is only subtracted when the boundary day is a
--     working day: an afternoon on a Sunday costs nothing, and no CHECK can see
--     the holiday calendar.
--   * OVERLAP. A morning off and an afternoon off on the same date do NOT
--     overlap, so the existing date-range test is too coarse. Deciding it needs
--     both windows' portions, which is a comparison between rows.
-- ============================================================================

CREATE TYPE leave_day_portion AS ENUM ('full_day', 'morning', 'afternoon');

--> statement-breakpoint

-- DEFAULT 'full_day' makes this behaviour-preserving: every existing row, and
-- every request from a caller that says nothing about portions, is a whole day
-- exactly as it was before.
ALTER TABLE workforce.leave_requests
  ADD COLUMN IF NOT EXISTS start_portion leave_day_portion NOT NULL DEFAULT 'full_day',
  ADD COLUMN IF NOT EXISTS end_portion   leave_day_portion NOT NULL DEFAULT 'full_day';

--> statement-breakpoint

ALTER TABLE workforce.leave_requests
  DROP CONSTRAINT IF EXISTS ck_leave_single_day_portions_match;

ALTER TABLE workforce.leave_requests
  ADD CONSTRAINT ck_leave_single_day_portions_match CHECK (
    start_date <> end_date OR start_portion = end_portion
  );

--> statement-breakpoint

ALTER TABLE workforce.leave_requests
  DROP CONSTRAINT IF EXISTS ck_leave_multi_day_start_portion;

ALTER TABLE workforce.leave_requests
  ADD CONSTRAINT ck_leave_multi_day_start_portion CHECK (
    start_date = end_date OR start_portion <> 'morning'
  );

--> statement-breakpoint

ALTER TABLE workforce.leave_requests
  DROP CONSTRAINT IF EXISTS ck_leave_multi_day_end_portion;

ALTER TABLE workforce.leave_requests
  ADD CONSTRAINT ck_leave_multi_day_end_portion CHECK (
    start_date = end_date OR end_portion <> 'afternoon'
  );

--> statement-breakpoint

ALTER TABLE workforce.leave_requests
  DROP CONSTRAINT IF EXISTS ck_leave_working_days_half_day_multiple;

ALTER TABLE workforce.leave_requests
  ADD CONSTRAINT ck_leave_working_days_half_day_multiple CHECK (
    working_days IS NULL OR working_days * 2 = trunc(working_days * 2)
  );
