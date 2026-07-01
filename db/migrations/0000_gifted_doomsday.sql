CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE SCHEMA "authz";
--> statement-breakpoint
CREATE SCHEMA "requests";
--> statement-breakpoint
CREATE SCHEMA "assets";
--> statement-breakpoint
CREATE SCHEMA "access";
--> statement-breakpoint
CREATE SCHEMA "compliance";
--> statement-breakpoint
CREATE SCHEMA "workforce";
--> statement-breakpoint
CREATE SCHEMA "audit";
--> statement-breakpoint
CREATE SCHEMA "messaging";
--> statement-breakpoint
CREATE SCHEMA "notifications";
--> statement-breakpoint
CREATE TYPE "public"."access_request_status" AS ENUM('pending', 'approved', 'rejected', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."access_type" AS ENUM('local_admin', 'pim_role', 'app_admin', 'vpn', 'other');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('in_stock', 'assigned', 'in_repair', 'retired', 'lost');--> statement-breakpoint
CREATE TYPE "public"."asset_type" AS ENUM('laptop', 'desktop', 'monitor', 'phone', 'tablet', 'peripheral', 'other');--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('active', 'on_leave', 'offboarded');--> statement-breakpoint
CREATE TYPE "public"."finding_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('open', 'acknowledged', 'resolved', 'risk_accepted');--> statement-breakpoint
CREATE TYPE "public"."leave_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."leave_type" AS ENUM('annual', 'sick', 'unpaid', 'parental', 'other');--> statement-breakpoint
CREATE TYPE "public"."overtime_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."request_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('pending', 'in_review', 'approved', 'rejected', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."scope_type" AS ENUM('global', 'self', 'team', 'dept', 'region');--> statement-breakpoint
CREATE TYPE "public"."shift_type" AS ENUM('night', 'on_call', 'weekend');--> statement-breakpoint
CREATE TYPE "public"."software_listing" AS ENUM('whitelisted', 'blacklisted', 'review');--> statement-breakpoint
CREATE TYPE "public"."timesheet_status" AS ENUM('draft', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "identity"."employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entra_oid" varchar(64),
	"email" varchar(255) NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"department" varchar(120),
	"job_title" varchar(120),
	"manager_id" uuid,
	"roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "employee_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"family_id" uuid NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authz"."approval_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authz"."permissions" (
	"key" varchar(120) PRIMARY KEY NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authz"."role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_key" varchar(120) NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_key_pk" PRIMARY KEY("role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "authz"."roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authz"."user_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"scope_type" "scope_type" DEFAULT 'global' NOT NULL,
	"scope_id" varchar(120),
	"granted_by" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests"."request_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"step" integer DEFAULT 1 NOT NULL,
	"approver_id" uuid NOT NULL,
	"decision" varchar(20) NOT NULL,
	"note" text,
	"delegated_from_id" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests"."request_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests"."request_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(80) NOT NULL,
	"requester_id" uuid NOT NULL,
	"assignee_id" uuid,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"priority" "request_priority" DEFAULT 'normal' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolution_note" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"sla_hours" integer,
	"sla_deadline" timestamp with time zone,
	"sla_breached_at" timestamp with time zone,
	"current_step" integer DEFAULT 1 NOT NULL,
	"total_steps" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets"."asset_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"returned_at" timestamp with time zone,
	"notes" varchar(500)
);
--> statement-breakpoint
CREATE TABLE "assets"."assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_tag" varchar(50) NOT NULL,
	"type" "asset_type" NOT NULL,
	"status" "asset_status" DEFAULT 'in_stock' NOT NULL,
	"manufacturer" varchar(120),
	"model" varchar(120),
	"serial_number" varchar(120),
	"mdm_device_id" varchar(128),
	"purchase_date" date,
	"warranty_expiry" date,
	"specs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"assigned_to" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access"."access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"grantee_id" uuid NOT NULL,
	"access_type" "access_type" NOT NULL,
	"target" varchar(200) NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "access"."access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"access_type" "access_type" NOT NULL,
	"target" varchar(200) NOT NULL,
	"justification" text NOT NULL,
	"duration_hours" varchar(10) NOT NULL,
	"status" "access_request_status" DEFAULT 'pending' NOT NULL,
	"reviewer_id" uuid,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid
);
--> statement-breakpoint
CREATE TABLE "compliance"."compliance_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid,
	"employee_id" uuid,
	"software_name" varchar(200) NOT NULL,
	"software_version" varchar(60),
	"severity" "finding_severity" DEFAULT 'medium' NOT NULL,
	"status" "finding_status" DEFAULT 'open' NOT NULL,
	"source" varchar(60) NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by" uuid,
	"resolution_note" text,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "compliance"."software_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"publisher" varchar(200),
	"listing" "software_listing" DEFAULT 'review' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workforce"."leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type" "leave_type" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"reason" text,
	"status" "leave_status" DEFAULT 'pending' NOT NULL,
	"reviewer_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid
);
--> statement-breakpoint
CREATE TABLE "workforce"."overtime_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"hours" numeric(4, 2) NOT NULL,
	"reason" text NOT NULL,
	"status" "overtime_status" DEFAULT 'pending' NOT NULL,
	"reviewer_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid
);
--> statement-breakpoint
CREATE TABLE "workforce"."shift_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"shift_type" "shift_type" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"note" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workforce"."timesheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"minutes_worked" integer DEFAULT 0 NOT NULL,
	"note" varchar(500),
	"status" timesheet_status DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit"."audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_email" varchar(255),
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(60) NOT NULL,
	"resource_id" varchar(64),
	"changes" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messaging"."email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to" varchar(320) NOT NULL,
	"template" varchar(100) NOT NULL,
	"vars" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"idempotency_key" varchar(255),
	"recipient_id" uuid,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "messaging"."notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"actor_id" uuid,
	"type" varchar(100) NOT NULL,
	"vars" jsonb NOT NULL,
	"resource_id" uuid,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"idempotency_key" varchar(255),
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "messaging"."outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" varchar(60) NOT NULL,
	"aggregate_id" varchar(64) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications"."in_app_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"actor_id" uuid,
	"type" varchar(100) NOT NULL,
	"title" varchar(500) NOT NULL,
	"body" text,
	"resource_type" varchar(50),
	"resource_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_event_id" uuid
);
--> statement-breakpoint
CREATE TABLE "notifications"."notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(100) NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "authz"."role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "authz"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz"."role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "authz"."permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authz"."user_role_assignments" ADD CONSTRAINT "user_role_assignments_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "authz"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests"."request_approvals" ADD CONSTRAINT "request_approvals_request_id_request_items_id_fk" FOREIGN KEY ("request_id") REFERENCES "requests"."request_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests"."request_comments" ADD CONSTRAINT "request_comments_request_id_request_items_id_fk" FOREIGN KEY ("request_id") REFERENCES "requests"."request_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access"."access_requests" ADD CONSTRAINT "access_requests_request_id_request_items_id_fk" FOREIGN KEY ("request_id") REFERENCES "requests"."request_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce"."leave_requests" ADD CONSTRAINT "leave_requests_request_id_request_items_id_fk" FOREIGN KEY ("request_id") REFERENCES "requests"."request_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce"."overtime_entries" ADD CONSTRAINT "overtime_entries_request_id_request_items_id_fk" FOREIGN KEY ("request_id") REFERENCES "requests"."request_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_employee_email" ON "identity"."employees" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_employee_entra_oid" ON "identity"."employees" USING btree ("entra_oid") WHERE entra_oid IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_employee_status" ON "identity"."employees" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_refresh_token_hash" ON "identity"."refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ix_refresh_token_employee" ON "identity"."refresh_tokens" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "ix_refresh_token_family" ON "identity"."refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "ix_refresh_token_expiry" ON "identity"."refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ix_deleg_from_active" ON "authz"."approval_delegations" USING btree ("from_user_id","ends_at");--> statement-breakpoint
CREATE INDEX "ix_deleg_to_active" ON "authz"."approval_delegations" USING btree ("to_user_id","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_role_key" ON "authz"."roles" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ura_user_role_global" ON "authz"."user_role_assignments" USING btree ("user_id","role_id","scope_type") WHERE scope_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ura_user_role_scoped" ON "authz"."user_role_assignments" USING btree ("user_id","role_id","scope_type","scope_id") WHERE scope_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_ura_user" ON "authz"."user_role_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ix_ra_request" ON "requests"."request_approvals" USING btree ("request_id","step");--> statement-breakpoint
CREATE INDEX "ix_rcomm_request" ON "requests"."request_comments" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_ri_requester" ON "requests"."request_items" USING btree ("requester_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_ri_status_type" ON "requests"."request_items" USING btree ("status","type","created_at");--> statement-breakpoint
CREATE INDEX "ix_ri_assignee" ON "requests"."request_items" USING btree ("assignee_id","status");--> statement-breakpoint
CREATE INDEX "ix_ri_expiry" ON "requests"."request_items" USING btree ("expires_at","status");--> statement-breakpoint
CREATE INDEX "ix_ri_sla" ON "requests"."request_items" USING btree ("sla_deadline","status");--> statement-breakpoint
CREATE INDEX "ix_assignment_asset" ON "assets"."asset_assignments" USING btree ("asset_id","assigned_at");--> statement-breakpoint
CREATE INDEX "ix_assignment_employee" ON "assets"."asset_assignments" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_asset_tag" ON "assets"."assets" USING btree ("asset_tag");--> statement-breakpoint
CREATE INDEX "ix_asset_serial" ON "assets"."assets" USING btree ("serial_number");--> statement-breakpoint
CREATE INDEX "ix_asset_status" ON "assets"."assets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_asset_assigned_to" ON "assets"."assets" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "ix_access_grant_grantee" ON "access"."access_grants" USING btree ("grantee_id");--> statement-breakpoint
CREATE INDEX "ix_access_grant_expiry" ON "access"."access_grants" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ix_access_request_requester" ON "access"."access_requests" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "ix_access_request_status" ON "access"."access_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ix_finding_status" ON "compliance"."compliance_findings" USING btree ("status","severity");--> statement-breakpoint
CREATE INDEX "ix_finding_asset" ON "compliance"."compliance_findings" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "ix_finding_employee" ON "compliance"."compliance_findings" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_software_name" ON "compliance"."software_catalog" USING btree ("name");--> statement-breakpoint
CREATE INDEX "ix_software_listing" ON "compliance"."software_catalog" USING btree ("listing");--> statement-breakpoint
CREATE INDEX "ix_leave_employee" ON "workforce"."leave_requests" USING btree ("employee_id","start_date");--> statement-breakpoint
CREATE INDEX "ix_leave_status" ON "workforce"."leave_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_overtime_employee" ON "workforce"."overtime_entries" USING btree ("employee_id","work_date");--> statement-breakpoint
CREATE INDEX "ix_overtime_status" ON "workforce"."overtime_entries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_shift_employee" ON "workforce"."shift_logs" USING btree ("employee_id","starts_at");--> statement-breakpoint
CREATE INDEX "ix_shift_type" ON "workforce"."shift_logs" USING btree ("shift_type","starts_at");--> statement-breakpoint
CREATE INDEX "ix_timesheet_employee_date" ON "workforce"."timesheets" USING btree ("employee_id","work_date");--> statement-breakpoint
CREATE INDEX "ix_timesheet_status" ON "workforce"."timesheets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_audit_actor" ON "audit"."audit_logs" USING btree ("actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ix_audit_resource" ON "audit"."audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "ix_audit_time" ON "audit"."audit_logs" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "ix_email_outbox_pending" ON "messaging"."email_outbox" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_email_outbox_idempotency" ON "messaging"."email_outbox" USING btree ("idempotency_key") WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_notif_outbox_pending" ON "messaging"."notification_outbox" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_notif_outbox_idempotency" ON "messaging"."notification_outbox" USING btree ("idempotency_key") WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_outbox_unpublished" ON "messaging"."outbox_events" USING btree ("published","created_at");--> statement-breakpoint
CREATE INDEX "ix_ian_recipient" ON "notifications"."in_app_notifications" USING btree ("recipient_id","is_read");--> statement-breakpoint
CREATE INDEX "ix_ian_created" ON "notifications"."in_app_notifications" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "ix_ian_resource" ON "notifications"."in_app_notifications" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ian_source_event_id" ON "notifications"."in_app_notifications" USING btree ("source_event_id") WHERE source_event_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_notif_pref_user_type" ON "notifications"."notification_preferences" USING btree ("user_id","type");