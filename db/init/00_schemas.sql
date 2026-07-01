-- ============================================================
-- OpsHub — Postgres container init script
-- Runs at container init (docker-entrypoint-initdb.d) via the
-- postgres superuser BEFORE any application connections.
--
-- Schemas (identity, authz, requests, assets, access, compliance,
-- workforce, audit, messaging, notifications) are intentionally
-- NOT created here — Drizzle migrations own the full DDL lifecycle
-- including CREATE SCHEMA statements. Running them here would cause
-- the first migration to fail with "schema already exists".
-- ============================================================

-- pgcrypto: built-in on PG 13+; included for completeness.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
