-- Add typed enums for baseline_checks category and status.
-- Schema comment was stale ('gpo' removed; 'endpoint', 'identity', 'other' added to match DTO).

CREATE TYPE "public"."baseline_check_category" AS ENUM (
  'asr', 'firewall', 'encryption', 'endpoint', 'identity', 'other'
);

CREATE TYPE "public"."baseline_check_status" AS ENUM (
  'pass', 'fail', 'warning', 'not_applicable'
);

ALTER TABLE "security_posture"."baseline_checks"
  ALTER COLUMN "category" TYPE "public"."baseline_check_category"
  USING "category"::"public"."baseline_check_category";

ALTER TABLE "security_posture"."baseline_checks"
  ALTER COLUMN "status" TYPE "public"."baseline_check_status"
  USING "status"::"public"."baseline_check_status";
