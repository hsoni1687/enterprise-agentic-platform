-- Migration 030: Durable, shared idempotency store for the API gateway.
--
-- Previously the gateway deduplicated trigger requests in a per-replica
-- in-memory map with a check-then-set race (two concurrent requests with the
-- same key could both start a workflow) and no cross-replica visibility.
--
-- This table backs an atomic reserve-then-complete flow:
--   • Reserve  = INSERT ... ON CONFLICT DO NOTHING  (exactly one caller wins)
--   • Complete = UPDATE ... SET workflow_id, status='completed'
--   • Release  = DELETE ... WHERE status='pending'  (failed work frees the key)
--
-- Keyed by (tenant_id, key) so the same idempotency key from two tenants does
-- not collide.

-- NOTE: migration 007 already created idempotency_keys with tenant_id UUID and
-- only (key, tenant_id, workflow_id, created_at). The original in-memory store
-- never used it. The reserve-then-complete store needs a few more columns and a
-- TEXT tenant_id (platform tenant ids like 'default-tenant' are not UUIDs), so
-- this migration RECONCILES the existing table rather than recreating it.

-- Fresh databases (where 007 somehow didn't run) still get a valid table.
CREATE TABLE IF NOT EXISTS idempotency_keys (
    tenant_id    TEXT        NOT NULL DEFAULT 'default-tenant',
    key          TEXT        NOT NULL,
    workflow_id  TEXT        NOT NULL DEFAULT '',
    run_id       TEXT        NOT NULL DEFAULT '',
    status       TEXT        NOT NULL DEFAULT 'pending',  -- pending | completed
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, key)
);

-- Reconcile the migration-007 shape: widen tenant_id to TEXT, give workflow_id a
-- default (the reserve INSERT only supplies tenant_id+key), and add the columns
-- the reserve-then-complete flow needs. All idempotent.
ALTER TABLE idempotency_keys ALTER COLUMN tenant_id   TYPE TEXT;
ALTER TABLE idempotency_keys ALTER COLUMN workflow_id SET DEFAULT '';
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS run_id TEXT NOT NULL DEFAULT '';
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

-- Supports a future TTL/eviction job (keys are otherwise kept forever).
CREATE INDEX IF NOT EXISTS idempotency_keys_created_idx ON idempotency_keys (created_at);

INSERT INTO schema_migrations (version) VALUES ('030')
    ON CONFLICT (version) DO NOTHING;
