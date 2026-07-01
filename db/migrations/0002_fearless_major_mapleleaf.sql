CREATE SCHEMA "storage";
--> statement-breakpoint
CREATE TYPE "public"."stored_file_status" AS ENUM('pending', 'completed', 'deleted');--> statement-breakpoint
CREATE TABLE "storage"."stored_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(512) NOT NULL,
	"original_name" varchar(255) NOT NULL,
	"mime_type" varchar(127) NOT NULL,
	"size_bytes" integer NOT NULL,
	"resource_type" varchar(64) NOT NULL,
	"status" "stored_file_status" DEFAULT 'pending' NOT NULL,
	"uploader_id" uuid NOT NULL,
	"linked_entity_type" varchar(64),
	"linked_entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "identity"."employees" ADD COLUMN "photo_storage_key" varchar(512);--> statement-breakpoint
ALTER TABLE "assets"."assets" ADD COLUMN "photo_storage_key" varchar(512);--> statement-breakpoint
ALTER TABLE "workforce"."leave_requests" ADD COLUMN "document_storage_key" varchar(512);--> statement-breakpoint
CREATE INDEX "ix_stored_file_status" ON "storage"."stored_files" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ix_stored_file_uploader" ON "storage"."stored_files" USING btree ("uploader_id");--> statement-breakpoint
CREATE INDEX "ix_stored_file_entity" ON "storage"."stored_files" USING btree ("linked_entity_type","linked_entity_id");--> statement-breakpoint
CREATE INDEX "ix_stored_file_created" ON "storage"."stored_files" USING btree ("created_at");