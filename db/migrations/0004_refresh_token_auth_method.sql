ALTER TABLE "identity"."refresh_tokens" ADD COLUMN "auth_method" varchar(10) NOT NULL DEFAULT 'sso';
