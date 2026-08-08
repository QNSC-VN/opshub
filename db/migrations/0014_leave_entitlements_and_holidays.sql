-- ============================================================================
-- Migration 0014: leave entitlements, holiday calendar, and a frozen day count
-- ============================================================================
-- Leave was approvable without anyone knowing what it cost. `leave_requests`
-- stored a start and an end date and nothing else: no day count, no working-day
-- calculation, no entitlement, no holiday calendar. An approver could not see
-- whether the employee had the days, and no report could total them.
--
-- Three additions, and one deliberate omission.
--
-- 1. `holidays` — reference data excluded from every working-day calculation.
--    `region` is NOT NULL defaulting to 'ALL' rather than nullable, so
--    (date, region) can be a plain unique index. Postgres treats NULLs as
--    distinct in a unique index, so a nullable region would let the same
--    national holiday be inserted any number of times.
--
-- 2. `leave_entitlements` — the annual grant per employee, per type, per year,
--    plus days carried over. A type with NO row here is UNTRACKED (unpaid and
--    compassionate leave are decided on their merits), which is why the balance
--    check skips a missing row instead of reading it as zero days.
--
-- 3. `leave_requests.working_days` — what the request costs, frozen at submit.
--
-- THE OMISSION: there is no `balance` column anywhere, on purpose. A balance is
-- `granted + carried_over - consumed`, derived on read. A stored counter drifts
-- the first time a request is cancelled, back-dated or corrected, and after that
-- no query can tell you whether the counter or the requests are wrong.
-- ============================================================================

CREATE TABLE IF NOT EXISTS workforce.holidays (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date        date NOT NULL,
  name        varchar(160) NOT NULL,
  region      varchar(32) NOT NULL DEFAULT 'ALL',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_holiday_date_region
  ON workforce.holidays (date, region);
CREATE INDEX IF NOT EXISTS ix_holiday_date
  ON workforce.holidays (date);

CREATE TABLE IF NOT EXISTS workforce.leave_entitlements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id        uuid NOT NULL,
  leave_type         leave_type NOT NULL,
  year               integer NOT NULL,
  granted_days       numeric(5,2) NOT NULL,
  carried_over_days  numeric(5,2) NOT NULL DEFAULT 0,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_entitlement
  ON workforce.leave_entitlements (employee_id, leave_type, year);
CREATE INDEX IF NOT EXISTS ix_leave_entitlement_employee
  ON workforce.leave_entitlements (employee_id, year);

ALTER TABLE workforce.leave_requests
  ADD COLUMN IF NOT EXISTS working_days numeric(5,2);

-- Backfill existing rows with a WEEKDAY count (Mon–Fri), not a working-day count.
--
-- The distinction is honest rather than pedantic: `holidays` is empty at this point
-- and no record exists of which days were public holidays when these requests were
-- filed, so subtracting holidays here would be inventing history. Any row this
-- overstates by a day is visible as a weekday count, and the alternative — leaving
-- NULL — would make every existing request contribute 0 to a balance and quietly
-- hand those employees their leave back.
--
-- generate_series over the inclusive window, counting ISO weekdays 1–5.
UPDATE workforce.leave_requests r
SET working_days = sub.days
FROM (
  SELECT lr.id,
         count(*) FILTER (WHERE EXTRACT(ISODOW FROM d) BETWEEN 1 AND 5) AS days
  FROM workforce.leave_requests lr
  CROSS JOIN generate_series(lr.start_date::timestamp, lr.end_date::timestamp, interval '1 day') AS d
  GROUP BY lr.id
) AS sub
WHERE r.id = sub.id
  AND r.working_days IS NULL;

-- Left NULLABLE deliberately. A NOT NULL default of 0 would be a lie for any row
-- the backfill could not compute, and the column's own docblock explains that NULL
-- means "predates the column".
