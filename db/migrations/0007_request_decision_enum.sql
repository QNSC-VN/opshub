-- Convert request_approvals.decision varchar to a typed enum.

CREATE TYPE "public"."request_decision" AS ENUM ('approved', 'rejected', 'delegated');

ALTER TABLE "requests"."request_approvals"
  ALTER COLUMN "decision" TYPE "public"."request_decision"
  USING "decision"::"public"."request_decision";
