-- Migration 031: Durable, tenant-scoped HITL approval store.
--
-- HITL approvals were previously held in a per-process in-memory sync.Map in
-- workflow-initiator. That meant pending approvals were lost on restart and were
-- invisible to other replicas — an operator's approve/deny could hit a replica
-- that never saw the request. This table makes approvals durable and shared.
--
-- The status transition (pending -> approved|denied) is performed with an atomic
-- UPDATE ... WHERE status='pending', which is the cross-replica equivalent of
-- the single-process mutex and prevents a double-approve race.

CREATE TABLE IF NOT EXISTS hitl_approvals (
    id            TEXT        PRIMARY KEY,
    workflow_id   TEXT        NOT NULL DEFAULT '',
    agent_id      TEXT        NOT NULL DEFAULT '',
    tenant_id     TEXT        NOT NULL,
    tool_name     TEXT        NOT NULL DEFAULT '',
    tool_args     JSONB       NOT NULL DEFAULT '{}',
    reason        TEXT        NOT NULL DEFAULT '',
    status        TEXT        NOT NULL DEFAULT 'pending',  -- pending | approved | denied
    approved_by   TEXT        NOT NULL DEFAULT '',
    approved_at   TIMESTAMPTZ,
    denial_reason TEXT        NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hitl_approvals_tenant_status_idx ON hitl_approvals (tenant_id, status);

INSERT INTO schema_migrations (version) VALUES ('031')
    ON CONFLICT (version) DO NOTHING;
