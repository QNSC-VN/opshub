CREATE SCHEMA "licenses";
--> statement-breakpoint
CREATE SCHEMA "catalog";
--> statement-breakpoint
CREATE SCHEMA "security_posture";
--> statement-breakpoint
CREATE TYPE "public"."license_status" AS ENUM('active', 'expiring_soon', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."license_type" AS ENUM('perpetual', 'subscription', 'per_seat', 'concurrent');--> statement-breakpoint
CREATE TABLE "workforce"."attendance_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"clocked_in_at" timestamp with time zone NOT NULL,
	"clocked_out_at" timestamp with time zone,
	"duration_minutes" integer,
	"is_remote" boolean DEFAULT false NOT NULL,
	"notes" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "licenses"."license_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"license_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"notes" varchar(500)
);
--> statement-breakpoint
CREATE TABLE "licenses"."software_licenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(150) NOT NULL,
	"vendor" varchar(120) NOT NULL,
	"license_type" "license_type" DEFAULT 'subscription' NOT NULL,
	"seat_count" integer,
	"cost_per_seat_cents" integer,
	"renewal_date" date,
	"status" "license_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"external_id" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(150) NOT NULL,
	"description" text,
	"category" varchar(80) DEFAULT 'other' NOT NULL,
	"icon_emoji" varchar(10) DEFAULT '📋',
	"approval_permission" varchar(100) DEFAULT 'requests.approve' NOT NULL,
	"sla_hours" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_posture"."baseline_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" varchar(40) NOT NULL,
	"check_name" varchar(300) NOT NULL,
	"status" varchar(20) DEFAULT 'not_applicable' NOT NULL,
	"device_id" varchar(64),
	"device_name" varchar(200),
	"expected_value" varchar(200),
	"actual_value" varchar(200),
	"details" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_posture"."secure_score_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"score" numeric(8, 2) NOT NULL,
	"max_score" numeric(8, 2) NOT NULL,
	"percentage_score" numeric(5, 2) NOT NULL,
	"score_date" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ix_attendance_employee" ON "workforce"."attendance_logs" USING btree ("employee_id","clocked_in_at");--> statement-breakpoint
CREATE INDEX "ix_la_license" ON "licenses"."license_assignments" USING btree ("license_id","assigned_at");--> statement-breakpoint
CREATE INDEX "ix_la_employee" ON "licenses"."license_assignments" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "ix_sl_name" ON "licenses"."software_licenses" USING btree ("name");--> statement-breakpoint
CREATE INDEX "ix_sl_status" ON "licenses"."software_licenses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_sl_renewal" ON "licenses"."software_licenses" USING btree ("renewal_date");--> statement-breakpoint
CREATE INDEX "ix_ci_category" ON "catalog"."catalog_items" USING btree ("category");--> statement-breakpoint
CREATE INDEX "ix_ci_active" ON "catalog"."catalog_items" USING btree ("is_active","sort_order");--> statement-breakpoint
CREATE INDEX "ix_baseline_category_status" ON "security_posture"."baseline_checks" USING btree ("category","status");--> statement-breakpoint
CREATE INDEX "ix_baseline_device" ON "security_posture"."baseline_checks" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "ix_baseline_checked_at" ON "security_posture"."baseline_checks" USING btree ("checked_at");--> statement-breakpoint
CREATE INDEX "ix_secure_score_date" ON "security_posture"."secure_score_snapshots" USING btree ("score_date");