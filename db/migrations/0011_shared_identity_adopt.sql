-- Adopt the shared @qnsc-vn/identity AuthService.
--
-- Additive only: opshub stays single-tenant (context_id is always NULL) and no
-- existing column is dropped or retyped. Adds the session fields the shared
-- AuthService persists (authorization context, CSRF double-submit token, SSO
-- provider) and an sso_identities link table so users resolve/JIT-provision via
-- (provider, provider_sub) instead of reading entra_oid off the employee.

-- 1. Session columns on refresh_tokens (maps to the package AuthSession shape).
ALTER TABLE identity.refresh_tokens
  ADD COLUMN IF NOT EXISTS context_id   varchar(120),
  ADD COLUMN IF NOT EXISTS sso_provider varchar(32),
  ADD COLUMN IF NOT EXISTS csrf_token   varchar(64);

-- Existing opshub sessions are all Entra SSO — record the provider so rotation
-- preserves the SSO auth method.
UPDATE identity.refresh_tokens SET sso_provider = 'entra' WHERE sso_provider IS NULL;

-- 2. SSO identity link table.
CREATE TABLE IF NOT EXISTS identity.sso_identities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES identity.employees(id) ON DELETE CASCADE,
  provider       varchar(32)  NOT NULL,
  provider_sub   varchar(255) NOT NULL,
  provider_email varchar(255) NOT NULL,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sso_identity_provider_sub
  ON identity.sso_identities (provider, provider_sub);
CREATE INDEX IF NOT EXISTS ix_sso_identity_user
  ON identity.sso_identities (user_id);

-- 3. Backfill sso_identities from existing employees' entra_oid so already-linked
-- SSO users resolve through the new port without a re-provision round-trip.
INSERT INTO identity.sso_identities (user_id, provider, provider_sub, provider_email)
SELECT id, 'entra', entra_oid, email
FROM identity.employees
WHERE entra_oid IS NOT NULL
ON CONFLICT (provider, provider_sub) DO NOTHING;
